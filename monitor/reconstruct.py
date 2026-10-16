"""Rebuild missing trend samples from accounting; never replace measurements."""
from __future__ import annotations


from bisect import bisect_left
from collections import defaultdict
import re


def array_tasks(label: str) -> int:
    body = re.search(r"_\[([^\]]+)\]", label)
    if not body:
        return 1
    count = 0
    for part in re.sub(r"%\d+$", "", body[1]).split(","):
        m = re.fullmatch(r"(\d+)(?:-(\d+)(?::(\d+))?)?", part)
        if not m:
            return 1
        lo, hi, step = int(m[1]), int(m[2] or m[1]), int(m[3] or 1)
        if hi < lo or step < 1:
            return 1
        count += (hi - lo) // step + 1
    return count or 1


def gap_times(existing: list[int], step: int, until: int, since: int | None = None) -> list[int]:
    times = sorted(existing)
    spans = [(a, b) for a, b in zip(times, times[1:]) if b - a > 2 * step]
    if since is not None and times and since < times[0] - 2 * step:
        spans.insert(0, (since - step, times[0]))
    return [t for a, b in spans for t in range(a + step, min(b - step // 2, until) + 1, step)]


def reconstruct(jobs: list[dict], times: list[int], accounts: set[str], pool_of, until: int, stale_before: int) -> list[dict]:
    deltas, pools = [], set()

    def add(start, end, key, value):
        if end > start and value:
            deltas.extend(((start, key, value), (end, key, -value)))

    for j in jobs:
        open_end = (until if j["last_seen"] >= stale_before else j["last_seen"]) + 1
        if j["start_ts"] is not None:
            pool = pool_of(j["partition"])
            pools.add(pool)
            end = j["end_ts"] if j["end_ts"] is not None else open_end
            add(j["start_ts"], end, ("pool", pool, "used"), j["gpus"])
            if j["account"] in accounts:
                add(j["start_ts"], end, ("account", j["account"], "run_gpus"), j["gpus"])
                add(j["start_ts"], end, ("account", j["account"], "run_jobs"), 1)
        wait_end = next((j[k] for k in ("start_ts", "end_ts") if j[k] is not None), open_end)
        tasks = array_tasks(j["label"]) if j["array_meta"] else 1
        queued = max(j["submit_ts"], j["eligible_ts"]) if not j["limited"] and j["eligible_ts"] is not None else None
        if j["account"] in accounts:
            add(j["submit_ts"], wait_end, ("account", j["account"], "pend_gpus"), j["gpus"] * tasks)
            add(j["submit_ts"], wait_end, ("account", j["account"], "pend_jobs"), tasks)
            if queued is not None:
                add(queued, wait_end, ("account", j["account"], "pend_gpus_queue"), j["gpus"] * tasks)
        if queued is not None:
            for p in {pool_of(p) for p in (j["req_partitions"] or j["partition"]).split(",") if p}:
                pools.add(p)
                add(queued, wait_end, ("pool", p, "pend_gpus_queue"), j["gpus"] * tasks)
    deltas.sort()
    level, i, out = defaultdict(int), 0, []
    for t in times:
        while i < len(deltas) and deltas[i][0] <= t:
            _, key, delta = deltas[i]
            level[key] += delta
            i += 1
        out.append(dict(ts=t, accounts=[dict(account=a, **{f: level[("account", a, f)] for f in (
            "run_gpus", "run_jobs", "pend_gpus", "pend_gpus_queue", "pend_jobs")}) for a in sorted(accounts)],
            pools=[dict(pool=p, used=level[("pool", p, "used")], pend_gpus_queue=level[("pool", p, "pend_gpus_queue")]) for p in sorted(pools)]))
    return out


def fill_gaps(store, meta: dict, config, now: int):
    synced = store.meta("sacct_synced_to")
    if synced is None:
        return
    rows = store.all("SELECT DISTINCT ts FROM acct_samples ORDER BY ts")
    anchor = store.meta("backfill_anchor", now)
    done = store.meta("backfill_done_days", 0) >= config.backfill_days
    since = max(anchor - config.backfill_days * 86400 + 3600, now - config.samples_days * 86400) if done else None
    want = gap_times([r["ts"] for r in rows], config.poll_seconds, synced - 60, since)
    if not want:
        return
    jobs = store.all("SELECT j.*, r.partitions req_partitions FROM jobs j LEFT JOIN req_parts r ON r.label=j.label WHERE submit_ts<=? AND (end_ts IS NULL OR end_ts>=?)", want[-1], want[0])
    accounts = {a["account"] for a in store.records("accounts")}
    rebuilt = reconstruct(jobs, want, accounts, lambda p: meta.get(p, {}).get("pool", p), synced, synced - 2 * config.history_seconds)
    refs = defaultdict(list)
    for row in store.all("SELECT * FROM pool_samples WHERE est=0 ORDER BY ts"):
        refs[row["pool"]].append(row)
    ref_times = {p: [r["ts"] for r in rows] for p, rows in refs.items()}
    for sample in rebuilt:
        pools = []
        for p in sample["pools"]:
            candidates = refs[p["pool"]]
            if not candidates:
                continue
            i = bisect_left(ref_times[p["pool"]], sample["ts"])
            ref = min(candidates[max(0, i - 1):i + 1], key=lambda r: abs(r["ts"] - sample["ts"]))
            used = min(p["used"], ref["total"])
            pools.append(dict(pool=p["pool"], used=used, total=ref["total"], planned=ref["planned"], down=ref["down"],
                              reserved=ref["reserved"], pend_gpus_queue=p["pend_gpus_queue"],
                              idle=max(0, ref["total"] - used - ref["planned"] - ref["down"] - ref["reserved"])))
        sample["pools"] = pools
    store.add_reconstructed(rebuilt)
