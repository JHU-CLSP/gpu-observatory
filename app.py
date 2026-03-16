"""FastAPI backend for GPU Stats Dashboard.

Runs the existing Python collector scripts via subprocess and exposes
the results as a REST API. Results are cached for CACHE_TTL_SECONDS.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import time
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CACHE_TTL_SECONDS = 30 * 60  # 30 minutes
HISTORY_MAX_POINTS = 48     # 24 hours at 30-min intervals

SCRIPTS: dict[str, Path] = {
    "dsai": Path(__file__).parent / "danielgpus_dsai.py",
    "rockfish": Path(__file__).parent / "danielgpus_rockfish.py",
    "ia1": Path(__file__).parent / "danielgpus_ia1.py",
}

# ---------------------------------------------------------------------------
# In-memory cache  { server_name -> {"data": ..., "fetched_at": float} }
# ---------------------------------------------------------------------------

_cache: dict[str, dict] = {}

# ---------------------------------------------------------------------------
# History buffer  — circular buffer of HistoricalDataPoint dicts
# ---------------------------------------------------------------------------

_history: deque[dict] = deque(maxlen=HISTORY_MAX_POINTS)


def _snapshot_to_history_point() -> dict | None:
    """Build a HistoricalDataPoint from the current cache. Returns None if any
    server is missing or errored."""
    dsai = _cache.get("dsai", {}).get("data", {})
    rockfish = _cache.get("rockfish", {}).get("data", {})
    ia1 = _cache.get("ia1", {}).get("data", {})

    if not dsai or not rockfish or not ia1:
        return None
    if dsai.get("error") or rockfish.get("error") or ia1.get("error"):
        return None

    return {
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dsai_team_usage": dsai.get("dkhasha1_totals", {}).get("total", 0),
        "dsai_total_usage": dsai.get("partition_totals", {}).get("used", 0),
        "dsai_pending_gpus": dsai.get("dkhasha1_pending", {}).get("total_gpus_requested", 0),
        "rockfish_team_usage": rockfish.get("dkhasha1_totals", {}).get("total", 0),
        "rockfish_total_usage": rockfish.get("partition_totals", {}).get("used", 0),
        "rockfish_pending_gpus": rockfish.get("dkhasha1_pending", {}).get("total_gpus_requested", 0),
        "ia1_active": ia1.get("summary", {}).get("active_gpus", 0),
        "ia1_allocated": ia1.get("summary", {}).get("allocated_gpus", 0),
        "ia1_pending_gpus": ia1.get("pending_summary", {}).get("total_gpus_requested", 0),
    }


def _is_stale(server: str) -> bool:
    entry = _cache.get(server)
    if entry is None:
        return True
    return (time.time() - entry["fetched_at"]) > CACHE_TTL_SECONDS


def _extract_json(output: str) -> dict:
    """Extract the last JSON object from script stdout.

    Scripts print human-readable text followed by a JSON block.
    We find the last occurrence of a line starting with '{'.
    """
    last_brace = output.rfind("\n{")
    if last_brace == -1:
        # Try if the output starts directly with {
        if output.strip().startswith("{"):
            return json.loads(output.strip())
        raise ValueError("No JSON block found in script output")
    return json.loads(output[last_brace:].strip())


async def _fetch_server(server: str) -> dict:
    """Run the collector script and update the cache."""
    script = SCRIPTS[server]
    try:
        proc = await asyncio.to_thread(
            subprocess.run,
            ["python3", str(script)],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"Script exited {proc.returncode}: {proc.stderr[:500]}")
        data = _extract_json(proc.stdout)
        _cache[server] = {"data": data, "fetched_at": time.time()}
        return data
    except Exception as exc:
        error_payload = {"error": str(exc), "data": None}
        _cache[server] = {"data": error_payload, "fetched_at": time.time()}
        return error_payload


async def _background_refresh_loop():
    """Runs on startup; refreshes all servers sequentially every TTL seconds."""
    while True:
        for server in SCRIPTS:
            await _fetch_server(server)
            # Small delay between servers to avoid hammering SSH concurrently
            await asyncio.sleep(2)
        point = _snapshot_to_history_point()
        if point:
            _history.append(point)
        await asyncio.sleep(CACHE_TTL_SECONDS)


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Kick off initial fetch and background loop on startup
    task = asyncio.create_task(_background_refresh_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="GPU Stats API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_cached_or_fetch(server: str) -> dict:
    if _is_stale(server):
        return await _fetch_server(server)
    return _cache[server]["data"]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/stats")
async def get_all_stats():
    results = await asyncio.gather(
        _get_cached_or_fetch("dsai"),
        _get_cached_or_fetch("rockfish"),
        _get_cached_or_fetch("ia1"),
    )
    return {"dsai": results[0], "rockfish": results[1], "ia1": results[2]}


@app.get("/stats/dsai")
async def get_dsai_stats():
    return await _get_cached_or_fetch("dsai")


@app.get("/stats/rockfish")
async def get_rockfish_stats():
    return await _get_cached_or_fetch("rockfish")


@app.get("/stats/ia1")
async def get_ia1_stats():
    return await _get_cached_or_fetch("ia1")


@app.post("/stats/refresh")
async def refresh_all():
    results = await asyncio.gather(
        _fetch_server("dsai"),
        _fetch_server("rockfish"),
        _fetch_server("ia1"),
    )
    point = _snapshot_to_history_point()
    if point:
        _history.append(point)
    return {"dsai": results[0], "rockfish": results[1], "ia1": results[2]}


@app.post("/stats/{server}/refresh")
async def refresh_server(server: str):
    if server not in SCRIPTS:
        raise HTTPException(status_code=404, detail=f"Unknown server: {server}")
    return await _fetch_server(server)


@app.get("/stats/history")
async def get_history():
    return list(_history)


# ---------------------------------------------------------------------------
# Serve built frontend (must be after all API routes)
# ---------------------------------------------------------------------------

FRONTEND_DIST = Path(__file__).parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="spa")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=443, reload=False)
