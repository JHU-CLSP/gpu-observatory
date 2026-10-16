"""Pure parsers ported from rcb/dashboard/server/src/cluster and slurm/capacity.

Command output uses epoch seconds. Unreadable records are skipped; no Slurm
commands or host reads happen here.
"""
from __future__ import annotations


from collections import defaultdict
from datetime import datetime
import math
import re

SEP = "\x1f"
QUEUE_REASONS = {"", "None", "Priority", "Resources", "Prolog", "Configuring"}
DEPENDENCY_REASONS = {"Dependency", "BeginTime", "DependencyNeverSatisfied"}
HOLD_REASONS = {"JobHeldUser", "JobHeldAdmin", "held", "RequeueHold", "RequeueJobHeldAdmin"}
MAINT_RE = re.compile(r"^(ReqNodeNotAvail|Reservation|ReservationDeleted|NodeDown|PartitionDown|PartitionInactive|PartitionNodeLimit|FrontEndDown|resv|Maint)", re.I)
LIMIT_RE = re.compile(r"^(Assoc|QOS|Max|JobArrayTaskLimit|Partition(Time|Config)Limit|AccountNotAllowed|InvalidQOS|InvalidAccount|Billing|Licenses|BurstBuffer|Cpus|NodeLimit|ReqTime|TimeLimit)", re.I)


def integer(value: str | None) -> int | None:
    return int(value) if value and re.fullmatch(r"-?\d+", value.strip()) else None


def number(value: str | None) -> float | None:
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def timestamp(value: str | None) -> int | None:
    value = (value or "").strip()
    n = integer(value)
    if n is not None:
        return n if n > 0 else None
    if not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d", value):
        return None
    try:
        return int(datetime.fromisoformat(value).timestamp())
    except ValueError:
        return None


def limit_seconds(value: str) -> int | None:
    m = re.fullmatch(r"(?:(\d+)-)?(\d+)(?::(\d+))?(?::(\d+))?", value.strip())
    if not m:
        return None
    d, x, y, z = (int(v) if v is not None else None for v in m.groups())
    if d is not None:
        return d * 86400 + x * 3600 + (y or 0) * 60 + (z or 0)
    if z is not None:
        return x * 3600 + y * 60 + z
    return x * 60 + (y or 0)


def memory_mb(value: str | None) -> int | None:
    m = re.fullmatch(r"(\d+(?:\.\d+)?)([KMGT]?)B?", (value or "").strip(), re.I)
    if not m:
        return None
    return math.ceil(float(m[1]) * {"": 1, "K": 1 / 1024, "M": 1, "G": 1024, "T": 1024**2}[m[2].upper()])


def tres(value: str) -> dict[str, float]:
    out = {}
    for item in value.split(","):
        key, _, val = item.partition("=")
        n = number(val)
        if n is not None:
            out[key] = n
    return out


def gpu_count(value: str) -> int:
    # The untyped total and typed GPU entries describe the same GPUs.
    matches = re.findall(r"(?:^|,)gres/gpu(?::[^=,]+)?[=:](\d+)", value)
    plain = re.search(r"(?:^|,)gres/gpu[=:](\d+)", value)
    return int(plain[1]) if plain else sum(map(int, matches))


def gpu_limit(value: str) -> int | None:
    return gpu_count(value) if re.search(r"gres/gpu[=:]", value) else None


def budgeted(value: dict | None) -> bool:
    # Skipjack writes 6e9 for unlimited budgets; actual budgets are much smaller.
    return bool(value) and any(n < 1e9 for n in value.values())


def shape(value: str) -> dict:
    fields = dict(part.split("=", 1) for part in value.split(",") if "=" in part)
    return {"gpus": gpu_count(value), "cpus": integer(fields.get("cpu")) or 1,
            "mem_mb": memory_mb(fields.get("mem")), "nodes": integer(fields.get("node")) or 1}


def wait_class(reason: str | None) -> str:
    r = (reason or "").strip()
    if r in QUEUE_REASONS:
        return "queue"
    if r in DEPENDENCY_REASONS:
        return "dependency"
    if r in HOLD_REASONS:
        return "hold"
    if MAINT_RE.match(r):
        return "maint"
    if LIMIT_RE.match(r):
        return "limit"
    return "other"


def is_limited(reason: str | None) -> bool:
    return wait_class(reason) not in {"queue", "dependency"}


def parse_jobs(stdout: str) -> list[dict]:
    out = []
    for line in stdout.splitlines():
        f = [s.strip() for s in line.split(SEP)]
        if len(f) < 17 or integer(f[0]) is None or timestamp(f[8]) is None:
            continue
        array = re.match(r"^(\d+)_(\[)?", f[1])
        state = re.split(r"[+\s]", f[12].upper())[0]
        out.append(dict(job_id=int(f[0]), submit_ts=timestamp(f[8]), label=f[1],
                        array_id=int(array[1]) if array else None, array_meta=bool(array and array[2]),
                        account=f[2], user=f[3], partition=f[4], qos=f[5], **shape(f[6]),
                        timelimit_s=limit_seconds(f[7]), eligible_ts=timestamp(f[9]),
                        start_ts=timestamp(f[10]), end_ts=timestamp(f[11]), state=state,
                        reason=f[13] or "None", restarts=integer(f[14]) or 0,
                        priority=integer(f[15]), reservation=f[16] if f[16] not in {"", "(null)"} else None))
    return out


def parse_queue(stdout: str) -> list[dict]:
    out = []
    for line in stdout.splitlines():
        f = [s.strip() for s in line.split("|")]
        if len(f) < 15 or integer(f[0]) is None:
            continue
        request = shape(f[7])
        request.pop("nodes")
        out.append(dict(job_id=int(f[0]), label=f[1], array_id=integer(f[2]) if "_" in f[1] else None,
                        account=f[3], user=f[4], state=f[5], partitions=list(filter(None, f[6].split(","))),
                        qos=f[13], **request, timelimit_s=limit_seconds(f[8]), submit_ts=timestamp(f[9]),
                        eligible_ts=timestamp(f[10]), start_ts=timestamp(f[11]), reason=f[12] or "None", priority=integer(f[14])))
    return out


def parse_shares(stdout: str) -> list[dict]:
    out = []
    for line in stdout.splitlines():
        f = [s.strip() for s in line.split("|")]
        if len(f) < 11 or not f[0]:
            continue
        out.append(dict(account=f[0], user=f[1] or None, raw_usage=number(f[4]), eff_usage=number(f[5]),
                        fairshare=number(f[6]), level_fs=number(f[7]), level_fs_inf=f[7].lower() == "inf",
                        budget_mins=tres(f[8]) if not f[1] else None, used=tres(f[9]), run=tres(f[10])))
    return out


def parse_associations(stdout: str) -> list[dict]:
    out = []
    for line in stdout.splitlines():
        f = [s.strip() for s in line.split("|")]
        if len(f) < 6 or not f[0]:
            continue
        out.append(dict(account=f[0], parent=f[1], user=f[2] or None, qos=f[3].split(",")[0],
                        grp_gpu=gpu_limit(f[4]), budget_mins=tres(f[5]) or None))
    return out


def parse_qos(stdout: str) -> dict[str, dict]:
    out = {}
    for line in stdout.splitlines():
        f = [s.strip() for s in line.split("|")]
        if len(f) >= 4 and f[0]:
            out[f[0]] = dict(qos_grp=gpu_limit(f[1]), qos_per_acct=gpu_limit(f[2]), qos_per_user=gpu_limit(f[3]))
    return out


def parse_partitions(stdout: str) -> dict[str, dict]:
    out = {}
    for line in stdout.splitlines():
        fields = dict(re.findall(r"(?:^|\s)(\w+)=(\S+)", line))
        name = fields.get("PartitionName")
        if name:
            out[name] = dict(name=name, pool=fields.get("NodeSets") or name,
                             hidden=fields.get("Hidden") == "YES", tier=integer(fields.get("PriorityTier")) or 1,
                             gpus=gpu_count(fields.get("TRES", "")), max_cpus=integer(fields.get("MaxCPUsPerNode")))
    return out


def parse_nodes(stdout: str) -> list[dict]:
    out = []
    for line in stdout.splitlines():
        f = line.split()
        if len(f) < 8:
            continue
        total = re.search(r"gpu:(?:[\w.-]+:)?(\d+)", f[3])
        used = re.search(r"gpu:(?:[\w.-]+:)?(\d+)\(IDX:([^)]*)\)", f[4])
        cpus = f[5].split("/")
        if not total or len(cpus) < 2:
            continue
        gpu_used = int(used[1]) if used else 0
        if used and used[2]:
            gpu_used = 0
            for part in used[2].split(","):
                idx = re.fullmatch(r"(\d+)(?:-(\d+))?", part)
                if idx:
                    gpu_used += int(idx[2] or idx[1]) - int(idx[1]) + 1
        out.append(dict(node=f[0], partition=f[1].rstrip("*"), state=f[2], gpu_total=int(total[1]),
                        gpu_used=gpu_used, cpu_alloc=integer(cpus[0]) or 0, cpu_idle=integer(cpus[1]) or 0,
                        mem_total_mb=integer(f[6]) or 0, mem_alloc_mb=integer(f[7]) or 0))
    return out


DOWN = {"down", "drain", "drained", "draining", "drng", "fail", "failing", "maint", "inval", "unknown", "future",
        "reboot", "reboot_issued", "reboot_requested", "powering_down", "powered_down", "power_down", "blocked", "not_resp"}


def node_free_kind(state: str) -> str:
    s = state.strip().lower()
    base = re.sub(r"[*~#!%$@^\-]+$", "", s)
    if re.search(r"[*~#!%@^]$", s) or any(b in DOWN for b in base.split("+")):
        return "down"
    if "reserved" in base.split("+") or s.endswith("$"):
        return "reserved"
    return "planned" if s.endswith("-") else "idle"


def account_load(queue: list[dict], accounts) -> dict[str, dict]:
    def empty(account):
        return dict(account=account, run_gpus=0, run_jobs=0, pend_gpus=0, pend_gpus_queue=0, pend_jobs=0, users={})
    out = {a: empty(a) for a in accounts}
    for job in queue:
        a = out.get(job["account"])
        if a is None:
            continue
        u = a["users"].setdefault(job["user"], dict(user=job["user"], run_gpus=0, pend_gpus=0))
        if job["state"] == "PD":
            a["pend_jobs"] += 1
            a["pend_gpus"] += job["gpus"]
            u["pend_gpus"] += job["gpus"]
            if wait_class(job["reason"]) == "queue":
                a["pend_gpus_queue"] += job["gpus"]
        elif job["state"] in {"R", "CG", "S"}:
            a["run_jobs"] += 1
            a["run_gpus"] += job["gpus"]
            u["run_gpus"] += job["gpus"]
    return out


def pool_capacity(nodes: list[dict], meta: dict, queue: list[dict]) -> tuple[list[dict], dict]:
    pools, shapes, seen = {}, defaultdict(lambda: {"cpus": [], "mem": []}), set()
    pool_of = lambda p: meta.get(p, {}).get("pool", p)
    for row in nodes:
        pool = pool_of(row["partition"])
        p = pools.setdefault(pool, dict(pool=pool, total=0, used=0, idle=0, planned=0, down=0, reserved=0, pend_gpus_queue=0))
        if (pool, row["node"]) in seen:
            continue
        seen.add((pool, row["node"]))
        total = row["gpu_total"]
        used = min(row["gpu_used"], total)
        p["total"] += total
        p["used"] += used
        p[node_free_kind(row["state"])] += total - used
        if total:
            cpu = row["cpu_alloc"] + row["cpu_idle"]
            cap = meta.get(row["partition"], {}).get("max_cpus")
            if cpu:
                shapes[pool]["cpus"].append(min(cpu, cap or cpu) / total)
            if row["mem_total_mb"]:
                shapes[pool]["mem"].append(row["mem_total_mb"] / total)
    for j in queue:
        if j["state"] == "PD" and wait_class(j["reason"]) == "queue":
            for pool in {pool_of(p) for p in j["partitions"]}:
                if pool in pools:
                    pools[pool]["pend_gpus_queue"] += j["gpus"]
    median = lambda xs: sorted(xs)[len(xs) // 2]
    return sorted(pools.values(), key=lambda p: p["pool"]), {
        pool: dict(cpus_per_gpu=median(s["cpus"]), mem_per_gpu_mb=median(s["mem"]))
        for pool, s in shapes.items() if s["cpus"] and s["mem"]}
