"""Eligibility-based Kaplan-Meier queue statistics, ported from rcb's monitor.

Arrays/bursts contribute one observation; pending and cancelled jobs are
right-censored. The submission account estimator is deliberately separate.
"""
from __future__ import annotations


from collections import defaultdict
import math

WINDOWS = {"24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400}
GPU_CLASSES = (("1", 1), ("2", 2), ("3-4", 4), ("5-8", 8), ("9+", math.inf))
TL_BUCKETS = (("1h", 3600), ("4h", 14400), ("12h", 43200), ("24h", 86400), ("long", math.inf))


def gpu_class(gpus: float) -> str:
    return next(key for key, maximum in GPU_CLASSES if max(1, math.ceil(gpus)) <= maximum)


def tl_bucket(seconds: int | None) -> str:
    return next(key for key, maximum in TL_BUCKETS if (seconds if seconds is not None else math.inf) <= maximum)


def effective_gpus(gpus: int, cpus: int, mem_mb: int | None, shape: dict | None) -> int:
    if not shape or not shape.get("cpus_per_gpu") or not shape.get("mem_per_gpu_mb"):
        return max(1, gpus)
    return max(1, gpus, math.ceil(cpus / shape["cpus_per_gpu"] - 1e-9),
               math.ceil((mem_mb or 0) / shape["mem_per_gpu_mb"] - 1e-9))


def observations(jobs: list[dict], now: int, include_limited=False, effective=None) -> list[dict]:
    groups = defaultdict(list)
    for j in jobs:
        if (j["array_meta"] or j["eligible_ts"] is None or j["restarts"] > 0 or j["reservation"]
                or j["state"] == "LOST" or (j["limited"] and not include_limited)):
            continue
        key = ("array", j["array_id"]) if j["array_id"] is not None else (
            j["user"], j["account"], j["partition"], j["gpus"], j["cpus"], j["mem_mb"], j["timelimit_s"], j["eligible_ts"] // 300)
        groups[key].append(j)
    out = []
    for group in groups.values():
        started = [j for j in group if j["start_ts"] is not None]
        first = min(started, key=lambda j: j["start_ts"] - j["eligible_ts"]) if started else None
        base = first or group[0]
        wait = max(0, first["start_ts"] - first["eligible_ts"]) if first else max(
            max(0, (j["end_ts"] if j["end_ts"] is not None else now) - j["eligible_ts"]) for j in group)
        listed = list(filter(None, (base["req_partitions"] or base["partition"]).split(",")))
        parts = [(first["partition"], True)] + [(p, False) for p in listed if p != first["partition"]] if first else [
            (p, False) for p in sorted(set(listed + base["partition"].split(","))) if p]
        for partition, event in parts:
            out.append(dict(partition=partition, gpus=effective(base, partition) if effective else base["gpus"],
                            timelimit_s=base["timelimit_s"], t=wait, event=event,
                            eligible_ts=base["eligible_ts"], priority=base.get("priority")))
    return out


def km_quantiles(obs: list[dict], quantiles=(0.5, 0.9)) -> dict:
    times = defaultdict(lambda: [0, 0])
    for o in obs:
        times[o["t"]][0 if o["event"] else 1] += 1
    at_risk, survival = len(obs), 1.0
    q = [None] * len(quantiles)
    for t, (events, censored) in sorted(times.items()):
        if events and at_risk:
            survival *= 1 - events / at_risk
            for i, quantile in enumerate(quantiles):
                if q[i] is None and survival <= 1 - quantile + 1e-12:
                    q[i] = t
        at_risk -= events + censored
    events = sum(o["event"] for o in obs)
    return dict(n=len(obs), events=events, censored=len(obs) - events, p50_sec=q[0], p90_sec=q[1],
                at_least_sec=max(times, default=0),
                immediate_frac=sum(o["event"] and o["t"] < 60 for o in obs) / events if events else 0)


def speed_table(obs: list[dict]) -> list[dict]:
    cells = defaultdict(list)
    for o in obs:
        cells[(o["partition"], gpu_class(o["gpus"]), tl_bucket(o["timelimit_s"]))].append(o)
    return [dict(partition=p, gpu_class=g, tl=t, **km_quantiles(rows)) for (p, g, t), rows in sorted(cells.items())]
