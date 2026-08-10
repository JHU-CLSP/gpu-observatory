#!/usr/bin/env python3
"""Usage collector for Skipjack (ARCH ColdFront REST API).

Unlike the other collectors, Skipjack is *not* reachable by SSH — it is only
accessible through the ARCH ColdFront portal REST API. This API is an
*accounting* API (Slurm job history: job counts, CPU/GPU/node hours), not live
GPU telemetry. There is therefore no per-GPU utilization / memory / occupancy
data available here — those fields simply do not exist upstream. See
arch-api-integration.md for the full brief.

What this collector surfaces:
  * cluster + partition metadata (names, GPU partition types, state)
  * the team's ColdFront project + member roster
  * team-wide job accounting (jobs, cpu_hours, gpu_hours, node_hours)
  * per-member accounting rollups (looped over the project roster)

Auth (strategy "A" in the brief — automatic token refresh):
  Config is read from env vars or the .env file next to this script:
    TOKEN        — current API token (Authorization: Token <token>)
    CF_USERNAME  — ARCH portal username  (for token refresh)
    CF_PASSWORD  — ARCH portal password  (for token refresh)
  ARCH tokens expire monthly. On a 401 the collector POSTs the credentials to
  /auth/token/ to mint a fresh token, rewrites TOKEN in .env, and retries the
  request once. If credentials are absent or refresh fails, it degrades
  gracefully (fails just this source with a clear message).

  Secrets are never logged or emitted in output. Keep .env out of git.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = os.environ.get("CF_API", "https://portal.arch.jhu.edu/api/v1").rstrip("/")
TIMEOUT = 20
MAX_RETRIES = 3
ENV_PATH = Path(__file__).parent / ".env"


def _read_env_file() -> dict:
    """Parse simple KEY=VALUE lines from the .env file next to this script."""
    values: dict = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            values[k.strip()] = v.strip()
    return values


_ENV = _read_env_file()


def _cfg(name: str, *aliases: str) -> str | None:
    for key in (name, *aliases):
        val = os.environ.get(key) or _ENV.get(key)
        if val:
            return val.strip()
    return None


TOKEN = _cfg("TOKEN", "CF_TOKEN")
USERNAME = _cfg("CF_USERNAME", "USERNAME")
PASSWORD = _cfg("CF_PASSWORD", "PASSWORD")

if not TOKEN and not (USERNAME and PASSWORD):
    raise RuntimeError("No credentials: set TOKEN, or CF_USERNAME+CF_PASSWORD, in env/.env")


class AuthError(Exception):
    """401/403 — token expired or not permitted, and refresh was not possible."""


def _persist_token(new_token: str) -> None:
    """Rewrite the TOKEN=... line in .env (or append it) so the fresh token
    survives across runs. Never touches any other line. Best-effort."""
    try:
        if ENV_PATH.exists():
            lines = ENV_PATH.read_text().splitlines()
        else:
            lines = []
        replaced = False
        for i, line in enumerate(lines):
            if line.strip().startswith("TOKEN=") and not line.strip().startswith("#"):
                lines[i] = f"TOKEN={new_token}"
                replaced = True
                break
        if not replaced:
            lines.append(f"TOKEN={new_token}")
        ENV_PATH.write_text("\n".join(lines) + "\n")
    except Exception as e:  # noqa: BLE001 — persistence is best-effort
        print(f"[skipjack] warning: could not persist refreshed token: {e}", file=sys.stderr)


def _refresh_token() -> bool:
    """POST credentials to /auth/token/ to mint a fresh token (strategy A).
    Rotates an expired token per the brief. Updates the module-global TOKEN and
    persists it to .env. Returns True on success."""
    global TOKEN
    if not (USERNAME and PASSWORD):
        return False
    data = urllib.parse.urlencode(
        {"username": USERNAME, "password": PASSWORD}
    ).encode()
    req = urllib.request.Request(
        f"{BASE}/auth/token/",
        data=data,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            payload = json.loads(resp.read().decode("utf-8", "replace"))
    except Exception as e:  # noqa: BLE001
        print(f"[skipjack] token refresh failed: {e}", file=sys.stderr)
        return False
    # DRF's obtain_auth_token returns {"token": "..."}; accept a couple aliases.
    new_token = payload.get("token") or payload.get("key") or payload.get("access")
    if not new_token:
        print("[skipjack] token refresh: no token field in response", file=sys.stderr)
        return False
    TOKEN = new_token.strip()
    _persist_token(TOKEN)
    print("[skipjack] token refreshed and persisted to .env", file=sys.stderr)
    return True


def _get(path: str, params: dict | None = None, _refreshed: bool = False):
    """GET a JSON endpoint with the auth header. Retries on 429/5xx with
    exponential backoff. On 401 attempts a one-time token refresh (strategy A)
    and retries; if that fails, raises AuthError. Returns parsed JSON."""
    url = f"{BASE}/{path.lstrip('/')}"
    if params:
        url += "?" + urllib.parse.urlencode(params)

    last_exc = None
    for attempt in range(MAX_RETRIES):
        req = urllib.request.Request(url, headers={
            "Authorization": f"Token {TOKEN}",
            "Accept": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                body = resp.read().decode("utf-8", "replace")
                ctype = resp.headers.get("Content-Type", "")
                if "application/json" not in ctype:
                    # Some endpoints (e.g. /allocations/) return an HTML login
                    # page for this token scope. Treat as unavailable, not fatal.
                    raise ValueError(f"non-JSON response ({ctype or 'unknown'})")
                return json.loads(body)
        except urllib.error.HTTPError as e:
            if e.code == 401 and not _refreshed and _refresh_token():
                # Fresh token in hand — retry this request exactly once.
                return _get(path, params, _refreshed=True)
            if e.code in (401, 403):
                raise AuthError(f"HTTP {e.code} — token expired/invalid and "
                                f"refresh unavailable")
            if e.code == 429 or e.code >= 500:
                last_exc = e
                time.sleep((2 ** attempt) + 0.1 * attempt)
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            last_exc = e
            time.sleep((2 ** attempt) + 0.1 * attempt)
    raise RuntimeError(f"GET {path} failed after {MAX_RETRIES} attempts: {last_exc}")


def _get_list(path: str, params: dict | None = None) -> list:
    """Fetch a DRF-paginated list endpoint, following `next` links."""
    results: list = []
    page = _get(path, params)
    while True:
        results.extend(page.get("results", []))
        nxt = page.get("next")
        if not nxt:
            break
        # `next` is an absolute URL; strip the base to reuse _get
        rel = nxt[len(BASE):] if nxt.startswith(BASE) else nxt
        page = _get(rel)
    return results


def _summary(user: str | None = None) -> dict:
    """jobs/summary rollup. Shape: {jobs, cpu_hours, gpu_hours, node_hours}."""
    params = {"user": user} if user else None
    data = _get("jobs/summary/", params)
    return {
        "jobs":       int(data.get("jobs", 0) or 0),
        "cpu_hours":  float(data.get("cpu_hours", 0) or 0),
        "gpu_hours":  float(data.get("gpu_hours", 0) or 0),
        "node_hours": float(data.get("node_hours", 0) or 0),
    }


def collect() -> dict:
    # --- cluster + partitions (reference metadata) ---
    clusters = _get_list("clusters/")
    cluster = clusters[0] if clusters else {}
    partitions = _get_list("partitions/")

    # --- project + member roster ---
    projects = _get_list("projects/")
    project = projects[0] if projects else {}
    members = list(project.get("members", []))

    # --- team-wide accounting (token is scoped to the team's visible data) ---
    team = _summary()

    # --- per-member accounting rollups ---
    member_rows = []
    for m in members:
        try:
            s = _summary(m)
        except AuthError:
            raise
        except Exception:
            s = {"jobs": 0, "cpu_hours": 0.0, "gpu_hours": 0.0, "node_hours": 0.0}
        member_rows.append({"user": m, **s})
    # busiest first, by gpu_hours then cpu_hours
    member_rows.sort(key=lambda r: (r["gpu_hours"], r["cpu_hours"]), reverse=True)

    gpu_partitions = [p["name"] for p in partitions
                      if p.get("name") in ("a100", "b200", "b300", "h200")]

    return {
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "server": "skipjack",
        "source": "arch-coldfront-api",
        "data_kind": "accounting",  # NOT live telemetry — see module docstring
        "cluster": {
            "name": cluster.get("name", "skipjack"),
            "type": cluster.get("cluster_type"),
            "is_active": cluster.get("is_active"),
            "api_version": cluster.get("api_version"),
        },
        "partitions": [
            {
                "name": p.get("name"),
                "is_default": p.get("is_default"),
                "state": p.get("state"),
                "max_time": p.get("max_time"),
                "is_gpu": p.get("name") in ("a100", "b200", "b300", "h200"),
            }
            for p in partitions
        ],
        "gpu_partitions": gpu_partitions,
        "project": {
            "title": project.get("title"),
            "pi": project.get("pi"),
            "status": project.get("status"),
            "member_count": len(members),
        },
        "team_summary": team,
        "members": member_rows,
    }


def _print_human(report: dict) -> None:
    print()
    print(f"=== Skipjack ({report['cluster'].get('name')}) — ARCH accounting ===")
    print("NOTE: accounting data (job/GPU hours), not live GPU telemetry.")
    print(f"Cluster: {report['cluster'].get('type')} | API {report['cluster'].get('api_version')}")
    print(f"GPU partitions: {', '.join(report['gpu_partitions']) or 'none'}")
    proj = report["project"]
    print(f"Project: {proj.get('title')} (PI {proj.get('pi')}, {proj.get('member_count')} members)")
    t = report["team_summary"]
    print()
    print(f"Team totals: {t['jobs']} jobs | {t['cpu_hours']:.1f} CPU-h | "
          f"{t['gpu_hours']:.1f} GPU-h | {t['node_hours']:.1f} node-h")
    print()
    print(f"{'USER':<12} {'JOBS':>6} {'GPU-H':>10} {'CPU-H':>10}")
    print(f"{'------------':<12} {'-----':>6} {'---------':>10} {'---------':>10}")
    for r in report["members"]:
        print(f"{r['user']:<12} {r['jobs']:>6} {r['gpu_hours']:>10.1f} {r['cpu_hours']:>10.1f}")
    print()


if __name__ == "__main__":
    try:
        report = collect()
        _print_human(report)
    except AuthError as e:
        # Strategy A: auto-refresh already attempted inside _get and failed.
        # Fail just this source gracefully — don't take down the whole dashboard.
        report = {
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "server": "skipjack",
            "error": f"ARCH auth failed ({e}). Automatic token refresh did not "
                     f"succeed — verify CF_USERNAME/CF_PASSWORD in .env.",
        }
        print(f"[skipjack] AUTH FAILURE: {report['error']}", file=sys.stderr)
    except Exception as e:
        report = {
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "server": "skipjack",
            "error": str(e),
        }
        print(f"[skipjack] ERROR: {e}", file=sys.stderr)

    print(json.dumps(report, indent=2))
