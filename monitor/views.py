"""Read models over the monitor database; invoked on ASGI worker threads."""
from __future__ import annotations


from collections import defaultdict
import json

from .parse import account_load, budgeted, is_limited
from .waits import WINDOWS, effective_gpus, gpu_class, observations, speed_table, tl_bucket

SERIES_STEPS = {"24h": 900, "7d": 7200, "30d": 28800}


def grid(now: int, span: int, step: int) -> list[int]:
    return list(range((now - span) // step * step, now + 1, step))


def bucket_average(points, buckets, step) -> list[float | None]:
    by = defaultdict(list)
    for ts, value in points:
        by[ts // step * step].append(value)
    return [round(sum(by[b]) / len(by[b]), 1) if by[b] else None for b in buckets]


def bucket_estimated(rows, buckets, step) -> list[bool]:
    by = defaultdict(list)
    for row in {r["ts"]: r for r in rows}.values():
        by[row["ts"] // step * step].append(row["est"])
    return [bool(by[b] and sum(by[b]) * 2 > len(by[b])) for b in buckets]


def minimum(values):
    present = [v for v in values if v is not None]
    return min(present) if present else None


def overview(mon, now_ms: int, user=None) -> dict:
    out = dict(available_users=[], selected_user=user, status=mon.status(), groups=[], pending_ours=[], capacity=[], top_accounts=[],
               sample_ms=None, server_now_ms=now_ms, server_timezone=mon.timezone)
    store = mon.store
    if store is None:
        return out
    with store.lock:
        now = now_ms // 1000
        accounts = store.records("accounts")
        out["available_users"] = sorted({u for a in accounts for u in a.get("members", {})})
        ours = {a["account"] for a in accounts}
        queue = store.records("queue")
        load = account_load(queue, ours)
        share_rows = store.all("SELECT s.* FROM shares s JOIN (SELECT account,max(ts) ts FROM shares GROUP BY account) m USING(account,ts)")
        shares = {r["account"]: json.loads(r["data"]) for r in share_rows}
        users = {(r["account"], r["user"]): json.loads(r["data"]) for r in store.all("SELECT * FROM user_shares")}
        trend_grid = grid(now, 86400, 900)
        trend_rows = store.all("SELECT * FROM acct_samples WHERE ts>=?", trend_grid[0])
        groups = {}
        for a in accounts:
            name = a["account"]
            l, s = load[name], shares.get(name, {})
            caps = a["caps"]
            budget = None
            for resource, divisor, unit in (("billing", 1, "billing-minutes"), ("gres/gpu", 60, "GPU-hours")):
                limit = (s.get("budget_mins") or {}).get(resource)
                if limit is not None and budgeted({resource: limit}):
                    used, running = s["used"].get(resource, 0), s["run"].get(resource, 0)
                    budget = dict(unit=unit, limit=limit / divisor, used=used / divisor,
                                  committed=running / divisor, remaining=(limit - used - running) / divisor)
                    break
            mine = users.get((name, user), {})
            membership = a.get("members", {}).get(user)
            top = sorted(l["users"].values(), key=lambda u: (-u["run_gpus"], -u["pend_gpus"], u["user"]))[:8]
            rows = [r for r in trend_rows if r["account"] == name]
            view = dict(account=name, group=a["group"], qos=a["qos"], member=(membership is not None) if user is not None else None, users=a["users"],
                        cap_gpus=minimum(caps.get(k) for k in ("acct_gpu", "qos_per_acct", "qos_grp")),
                        user_cap_gpus=minimum(((membership or {}).get("gpu_cap"), caps.get("qos_per_user"))) if membership is not None else None,
                        run=dict(gpus=l["run_gpus"], jobs=l["run_jobs"]),
                        pend=dict(gpus=l["pend_gpus"], gpus_queue=l["pend_gpus_queue"], jobs=l["pend_jobs"]),
                        level_fs=s.get("level_fs"), level_fs_inf=s.get("level_fs_inf", False),
                        user_fairshare=mine.get("fairshare"), budget=budget,
                        top_users=[dict(**u, fairshare=users.get((name, u["user"]), {}).get("fairshare")) for u in top],
                        trend=bucket_average([(r["ts"], r["run_gpus"]) for r in rows], trend_grid, 900),
                        trend_est=bucket_estimated(rows, trend_grid, 900))
            group = groups.setdefault(a["group"], dict(name=a["group"], run_gpus=0, pend_gpus=0, accounts=[]))
            group["accounts"].append(view)
            group["run_gpus"] += l["run_gpus"]
            group["pend_gpus"] += l["pend_gpus"]
        out["groups"] = list(groups.values())
        out["sample_ms"] = store.meta("queue_ts")
        if out["sample_ms"] is not None:
            out["sample_ms"] *= 1000
        pending = sorted((q for q in queue if q["state"] == "PD" and q["account"] in ours),
                         key=lambda q: q["eligible_ts"] if q["eligible_ts"] is not None else float("inf"))[:300]
        out["pending_ours"] = [dict(job_id=q["label"], account=q["account"], user=q["user"], partitions=q["partitions"],
                                    gpus=q["gpus"], time_limit_sec=q["timelimit_s"], reason=q["reason"], limited=is_limited(q["reason"]),
                                    eligible_ms=q["eligible_ts"] * 1000 if q["eligible_ts"] is not None else None,
                                    est_start_ms=q["start_ts"] * 1000 if q["start_ts"] is not None else None,
                                    priority=q["priority"]) for q in pending]
        meta = mon.partition_meta
        preempted = store.all("SELECT partition,account,end_ts FROM jobs WHERE state='PREEMPTED' AND end_ts>=?", now - 7 * 86400)
        pools = store.all("SELECT p.* FROM pool_samples p JOIN (SELECT pool,max(ts) ts FROM pool_samples WHERE est=0 GROUP BY pool) m USING(pool,ts) ORDER BY pool")
        for p in pools:
            pre = [j for j in preempted if meta.get(j["partition"], {}).get("pool", j["partition"]) == p["pool"]]
            out["capacity"].append(dict(**{k: p[k] for k in ("pool", "total", "used", "idle", "planned", "down", "reserved", "pend_gpus_queue")},
                                        lanes=sorted([dict(partition=m["name"], hidden=m["hidden"], tier=m["tier"]) for m in meta.values() if m["pool"] == p["pool"]], key=lambda m: m["tier"]),
                                        preempted_24h=sum(j["end_ts"] >= now - 86400 for j in pre),
                                        preempted_7d=len(pre), preempted_ours_7d=sum(j["account"] in ours for j in pre)))
        top = account_load(queue, {q["account"] for q in queue})
        out["top_accounts"] = [dict(account=a["account"], run_gpus=a["run_gpus"], pend_gpus=a["pend_gpus"], ours=a["account"] in ours)
                               for a in sorted(top.values(), key=lambda a: (-a["run_gpus"], -a["pend_gpus"], a["account"]))[:20]]
        return out


def queue_speed(mon, window: str, scope: str, include_limited: bool, now_ms: int) -> dict:
    out = dict(window=window, scope=scope, include_limited=include_limited, partitions=mon.partitions, rows=[],
               generated_at_ms=now_ms, sacct_synced_to_ms=None)
    store = mon.store
    if store is None:
        return out
    with store.lock:
        now = now_ms // 1000
        synced = store.meta("sacct_synced_to")
        out["sacct_synced_to_ms"] = synced * 1000 if synced is not None else None
        ours = {a["account"] for a in store.records("accounts")}
        stamp = (window, scope, include_limited, mon.last_tick, synced, store.meta("history_revision", 0), now // 60)
        if stamp in mon.speed_cache:
            return mon.speed_cache[stamp]
        jobs = store.wait_jobs(now - WINDOWS[window])
        if scope == "ours":
            jobs = [j for j in jobs if j["account"] in ours]
        shapes = store.meta("node_shapes", {})

        def effective(job, partition):
            pool = mon.partition_meta.get(partition, {}).get("pool", partition)
            return effective_gpus(job["gpus"], job["cpus"], job["mem_mb"], shapes.get(pool))

        waiting = defaultdict(list)
        for q in store.records("queue"):
            if q["state"] != "PD" or q["eligible_ts"] is None or (is_limited(q["reason"]) and not include_limited) or (scope == "ours" and q["account"] not in ours):
                continue
            for p in q["partitions"]:
                waiting[(p, gpu_class(effective(q, p)), tl_bucket(q["timelimit_s"]))].append(max(0, now - q["eligible_ts"]))
        for row in speed_table(observations(jobs, now, include_limited, effective)):
            ages = sorted(waiting[(row["partition"], row["gpu_class"], row["tl"])])
            row["pending_now"] = dict(n=len(ages), median_age_sec=ages[len(ages) // 2] if ages else None,
                                      oldest_age_sec=ages[-1] if ages else None)
            out["rows"].append(row)
        mon.speed_cache.clear()
        mon.speed_cache[stamp] = out
        return out


def series(mon, metric: str, window: str, now_ms: int) -> dict:
    step = SERIES_STEPS[window]
    buckets = grid(now_ms // 1000, WINDOWS[window], step)
    out = dict(metric=metric, window=window, step_sec=step, t=[b * 1000 for b in buckets], series=[], totals={}, estimated=[False] * len(buckets))
    store = mon.store
    if store is None:
        return out
    with store.lock:
        if metric == "groups":
            accounts = {a["account"]: a["group"] for a in store.records("accounts")}
            rows = store.all("SELECT * FROM acct_samples WHERE ts>=?", buckets[0])
            for group in dict.fromkeys(accounts.values()):
                per_ts = defaultdict(lambda: [0, 0])
                for r in rows:
                    if accounts.get(r["account"]) == group:
                        per_ts[r["ts"]][0] += r["run_gpus"]
                        per_ts[r["ts"]][1] += r["pend_gpus_queue"]
                for i, suffix in enumerate(("running", "waiting")):
                    out["series"].append(dict(name=f"{group} {suffix}", values=bucket_average([(ts, v[i]) for ts, v in per_ts.items()], buckets, step)))
        else:
            rows = store.all("SELECT * FROM pool_samples WHERE ts>=? ORDER BY ts", buckets[0])
            for pool in sorted({r["pool"] for r in rows}):
                mine = [r for r in rows if r["pool"] == pool]
                out["totals"][pool] = mine[-1]["total"]
                out["series"].append(dict(name=pool, values=bucket_average([(r["ts"], r["used"]) for r in mine], buckets, step)))
        out["estimated"] = bucket_estimated(rows, buckets, step)
        return out
