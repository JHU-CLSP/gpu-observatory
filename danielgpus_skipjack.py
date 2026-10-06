#!/usr/bin/env python3
"""GPU usage dashboard for the Skipjack SLURM cluster.
Shows per-GPU-type totals (free/down/utilized), dkhasha1 team usage
within each type, and cluster-wide usage by account.

Run locally — if SLURM tools aren't found, re-executes itself on the
skipjack remote server via SSH automatically.
"""

import json
import os
import re
import statistics
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone

REMOTE = "skipjack"

if os.environ.get("_GPUSTATS_ON_REMOTE") != "1":
    sys.exit(subprocess.run(
        ["ssh", REMOTE, "env", "_GPUSTATS_ON_REMOTE=1", "python3", "-"],
        stdin=open(__file__)
    ).returncode)

# Non-interactive SSH commands don't source /etc/profile.d/00-slurm.sh, so
# sinfo/scontrol/squeue aren't on PATH by default on skipjack's login node.
os.environ["PATH"] = "/opt/mprov/cloack/slurm/current/bin:" + os.environ.get("PATH", "")

# Each partition here is a single GPU type (partition name == GPU type).
# The "med" partition (CPU-only) is intentionally excluded — no GRES.
PARTITIONS = ["a100", "b200", "b300", "h100", "h200", "l40s", "rtx6000"]
TEAM_ACCOUNT = "dkhasha1"

# rtx6000 nodes (gr101-103) are also reachable via a second, condo-restricted
# submission partition tied to our dkhasha1_rtx6000 sub-account. It's the same
# physical GPUs, so alias it onto "rtx6000" rather than tracking it as its own
# capacity bucket (which would double-count the nodes).
PARTITION_ALIASES = {"rtx6000_condo": "rtx6000"}

# Skipjack's node states include "drng" (draining) in addition to the
# down|drain|not_resp|maint states seen on dsai.
DOWN_STATE_RE = r"down|drain|drng|not_resp|maint|fail"


def run(cmd):
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
    return result.stdout


# Our team owns sub-accounts under dkhasha1 too (e.g. "dkhasha1_main_a" for a
# specific allocation/QOS), which sacctmgr treats as distinct SLURM accounts.
# Usage under any of them is still "our" usage, so discover them dynamically
# rather than hardcoding — new sub-accounts show up automatically.
def get_team_accounts():
    out = run(["sacctmgr", "show", "account", "format=Account%40", "-n", "-P"])
    accounts = {line.strip() for line in out.splitlines() if line.strip()}
    matches = sorted(a for a in accounts if a == TEAM_ACCOUNT or a.startswith(TEAM_ACCOUNT + "_"))
    return matches or [TEAM_ACCOUNT]


TEAM_ACCOUNTS = get_team_accounts()


# Some sub-accounts carry a hard cluster-enforced cap (GrpTRES on the bare
# account-level association, e.g. dkhasha1_rtx6000's condo allocation of 8
# GPUs) - surface it so usage can be shown as "X / cap" where one exists.
# Others (e.g. main/main_a/safety/safety_b) only have shared QOS limits that
# aren't exclusive to this account, so they simply have no cap here.
def get_team_account_caps():
    out = run(["sacctmgr", "show", "assoc", "format=Account%40,User%20,GrpTRES%40", "-n", "-P"])
    caps = {}
    for line in out.splitlines():
        parts = line.split("|")
        if len(parts) < 3:
            continue
        acct, user, grptres = parts[0].strip(), parts[1].strip(), parts[2].strip()
        if user or not grptres:
            continue
        m = re.search(r"gres/gpu=(\d+)", grptres)
        if m:
            caps[acct] = int(m.group(1))
    return caps


TEAM_ACCOUNT_CAPS = get_team_account_caps()


# Fair share: Skipjack uses priority/multifactor with Fair Tree, where fair
# share carries the largest weight. LevelFS (NormShares / EffectvUsage) is
# what Fair Tree ranks siblings by at each level: >1 means under-using its
# share, <1 over-using. sshare -P keeps leading spaces on Account to mark tree
# depth, which lets us recover both our sub-account tree and the chain of
# ancestors above it (e.g. csci -> en).
def _parse_float(s):
    try:
        return float(s)
    except ValueError:
        return None


def get_fairshare():
    out = run(["sshare", "-l", "-P", "-n", "-o", "Account,User,RawShares,NormShares,EffectvUsage,LevelFS"])
    rows = []
    for line in out.splitlines():
        parts = line.split("|")
        if len(parts) < 6 or parts[1].strip():
            continue  # user-level rows
        name = parts[0].strip()
        level_fs = _parse_float(parts[5].strip())
        rows.append({
            "account": name,
            "depth": len(parts[0]) - len(parts[0].lstrip(" ")),
            "raw_shares": parts[2].strip(),
            "norm_shares": _parse_float(parts[3].strip()),
            "effective_usage": _parse_float(parts[4].strip()),
            # "inf" (no usage at all) isn't valid JSON; flag it as unused instead.
            "level_fs": None if level_fs == float("inf") else level_fs,
            "unused": level_fs == float("inf"),
        })

    pi_name = "pi-" + TEAM_ACCOUNT
    pi_idx = next((i for i, r in enumerate(rows) if r["account"] == pi_name), None)
    if pi_idx is None:
        return None

    # Ancestors: walk upward, taking each row shallower than the last one seen.
    ancestors = []
    depth = rows[pi_idx]["depth"]
    for r in reversed(rows[:pi_idx]):
        if r["depth"] < depth and r["account"] != "root":
            ancestors.append(r)
            depth = r["depth"]
            if depth == 0:
                break

    # Our subtree: everything after pi-dkhasha1 that is nested deeper than it.
    accounts = []
    for r in rows[pi_idx + 1:]:
        if r["depth"] <= rows[pi_idx]["depth"]:
            break
        accounts.append(dict(r, depth=r["depth"] - rows[pi_idx]["depth"] - 1))

    # sprio's normalized fair-share factor (0-1) is what actually goes into a
    # pending job's priority, after the whole tree is taken into account -
    # e.g. a sub-account nested under a 0-share parent gets ~0 here even if its
    # own LevelFS looks fine. Only pending jobs appear in sprio.
    sprio_out = run(["sprio", "-h", "-o", "%i|%o|%f"])
    team_factors = defaultdict(list)
    cluster_factors = []
    for line in sprio_out.splitlines():
        parts = line.split("|")
        if len(parts) < 3:
            continue
        f = _parse_float(parts[2].strip())
        if f is None:
            continue
        cluster_factors.append(f)
        if parts[1].strip() in TEAM_ACCOUNTS:
            team_factors[parts[1].strip()].append(f)
    for a in accounts:
        samples = team_factors.get(a["account"])
        a["pending_jobs"] = len(samples) if samples else 0
        a["pending_fs_factor"] = statistics.median(samples) if samples else None

    return {
        "weight": PRIORITY_WEIGHT_FAIRSHARE,
        "pi": rows[pi_idx],
        "ancestors": ancestors,
        "accounts": accounts,
        "cluster_median_pending_fs_factor": statistics.median(cluster_factors) if cluster_factors else None,
    }


def get_priority_weight_fairshare():
    out = run(["scontrol", "show", "config"])
    m = re.search(r"PriorityWeightFairShare\s*=\s*(\d+)", out)
    return int(m.group(1)) if m else None


PRIORITY_WEIGHT_FAIRSHARE = get_priority_weight_fairshare()
FAIRSHARE = get_fairshare()


# ============================================================
# Section 1: Total / used / idle / down GPUs per type
# ============================================================

node_partition = {}
sinfo_out = run([
    "sinfo", "-N",
    "-p", ",".join(PARTITIONS),
    "-o", "%N|%P|%G|%t",
    "--noheader",
])
seen = set()
for line in sinfo_out.splitlines():
    parts = line.split("|")
    if len(parts) < 2:
        continue
    node = parts[0].strip()
    part = parts[1].strip().rstrip("*")
    if node not in seen:
        node_partition[node] = part
        seen.add(node)

part_total = defaultdict(int)
part_alloc = defaultdict(int)
part_idle  = defaultdict(int)
part_down  = defaultdict(int)

scontrol_out = run(["scontrol", "show", "node"])

current_node = None
current_gres_total = 0
current_gres_alloc = 0
current_state = ""


def process_node():
    if not current_node or current_node not in node_partition:
        return
    part = node_partition[current_node]
    if re.search(DOWN_STATE_RE, current_state, re.IGNORECASE):
        part_down[part] += current_gres_total
        return
    part_total[part] += current_gres_total
    part_alloc[part] += current_gres_alloc
    part_idle[part]  += current_gres_total - current_gres_alloc


for line in scontrol_out.splitlines():
    if line.startswith("NodeName="):
        process_node()
        m = re.search(r"NodeName=(\S+)", line)
        current_node = m.group(1) if m else None
        current_gres_total = 0
        current_gres_alloc = 0
        current_state = ""

    # Skipjack's GRES/AllocTRES are untyped (gres/gpu=N, not gres/gpu:h100=N),
    # so CfgTRES/AllocTRES parsing is done by hand here.
    if "CfgTRES=" in line:
        m = re.search(r"gres/gpu=(\d+)", line)
        if m:
            current_gres_total = int(m.group(1))
    elif "Gres=" in line and "AllocTRES" not in line and "CfgTRES" not in line:
        m = re.search(r"gpu(?::[^,()\s]+)*:(\d+)", line)
        if m:
            current_gres_total = int(m.group(1))

    if "AllocTRES=" in line:
        m = re.search(r"gres/gpu=(\d+)", line)
        if m:
            current_gres_alloc = int(m.group(1))

    if "State=" in line:
        m = re.search(r"State=(\S+)", line)
        if m:
            current_state = m.group(1)

process_node()  # handle last node

print()
print(f"{'TYPE':<8} {'TOTAL':>6} {'USED':>6} {'IDLE':>6} {'DOWN':>6}")
print(f"{'--------':<8} {'-----':>6} {'-----':>6} {'-----':>6} {'-----':>6}")

grand_total = grand_alloc = grand_idle = grand_down = 0
for part in PARTITIONS:
    t, a, i, d = part_total[part], part_alloc[part], part_idle[part], part_down[part]
    print(f"{part:<8} {t:>6} {a:>6} {i:>6} {d:>6}")
    grand_total += t; grand_alloc += a; grand_idle += i; grand_down += d

print(f"{'--------':<8} {'-----':>6} {'-----':>6} {'-----':>6} {'-----':>6}")
print(f"{'TOTAL':<8} {grand_total:>6} {grand_alloc:>6} {grand_idle:>6} {grand_down:>6}")


# ============================================================
# Section 1b: Partition access info (raw ACLs, no accessibility judgment)
# ============================================================

partition_access = {}
for p in PARTITIONS:
    info = run(["scontrol", "show", "partition", p])
    def field(name):
        m = re.search(rf"{name}=(\S+)", info)
        return m.group(1) if m else None
    partition_access[p] = {
        "allow_accounts": field("AllowAccounts"),
        "deny_accounts":  field("DenyAccounts"),
        "allow_qos":      field("AllowQos"),
        "deny_qos":       field("DenyQos"),
    }


# ============================================================
# Section 2: dkhasha1 team GPU usage (running jobs)
# ============================================================

user_gpus = {part: defaultdict(int) for part in PARTITIONS}
user_account_gpus = defaultdict(lambda: defaultdict(int))
# Per exact sub-account (unfolded - "dkhasha1_rtx6000" stays its own row here,
# unlike Section 4's cluster-wide ranking which folds sub-accounts into one
# "dkhasha1" bar) so we can show which of our own accounts is saturated.
team_account_gpus = {acct: defaultdict(int) for acct in TEAM_ACCOUNTS}
users_seen = []

squeue_out = run([
    "squeue",
    # Partition width must exceed the longest partition name (e.g.
    # "rtx6000_condo", 13 chars) - squeue's fixed-width -O output runs a
    # column that overflows its declared width straight into the next
    # column with no separating space, which silently corrupts the
    # whitespace-based split() below for any job in that partition.
    "-O", "JobID:12,UserName:20,Partition:20,tres-alloc:100,Account:20",
    "--account=" + ",".join(TEAM_ACCOUNTS),
    "-t", "R",
    "--noheader",
])

for line in squeue_out.splitlines():
    fields = line.split()
    if len(fields) < 3:
        continue
    user = fields[1].strip()
    part = fields[2].strip().rstrip("*")
    part = PARTITION_ALIASES.get(part, part)
    tres = fields[3].strip() if len(fields) > 3 else ""
    account = fields[4].strip() if len(fields) > 4 else TEAM_ACCOUNT

    if part not in PARTITIONS:
        continue

    m = re.search(r"gres/gpu[^=,\s]*=(\d+)", tres)
    gpus = int(m.group(1)) if m else 0

    if user not in users_seen:
        users_seen.append(user)

    user_gpus[part][user] += gpus
    user_account_gpus[user][account] += gpus
    if account in team_account_gpus:
        team_account_gpus[account][part] += gpus


def user_total(u):
    return sum(user_gpus[p][u] for p in PARTITIONS)


sorted_users = sorted(users_seen, key=user_total, reverse=True)

col_headers = [p.upper() for p in PARTITIONS]
print()
print(f"=== {TEAM_ACCOUNT} account GPU usage ===")
print(f"{'USER':<15}" + "".join(f" {h:>6}" for h in col_headers) + f" {'TOTAL':>6}")
print(f"{'-------------':<15}" + "".join(f" {'-----':>6}" for _ in PARTITIONS) + f" {'-----':>6}")

part_totals = defaultdict(int)
grand = 0
for u in sorted_users:
    ut = user_total(u)
    if ut == 0:
        continue
    row = "".join(f" {user_gpus[p][u]:>6}" for p in PARTITIONS)
    print(f"{u:<15}{row} {ut:>6}")
    for p in PARTITIONS:
        part_totals[p] += user_gpus[p][u]
    grand += ut

print(f"{'-------------':<15}" + "".join(f" {'-----':>6}" for _ in PARTITIONS) + f" {'-----':>6}")
totals_row = "".join(f" {part_totals[p]:>6}" for p in PARTITIONS)
print(f"{'TOTAL':<15}{totals_row} {grand:>6}")
print()


# ============================================================
# Section 3: Pending jobs (dkhasha1 team)
# ============================================================

pending_out = run([
    "squeue",
    "-o", "%i|%u|%P|%b|%r|%V|%a|%S|%Q",
    "--account=" + ",".join(TEAM_ACCOUNTS),
    "-t", "PD",
    "--noheader",
])

pending_jobs = []
pending_user_gpus = defaultdict(int)
team_account_pending_gpus = {acct: 0 for acct in TEAM_ACCOUNTS}

for line in pending_out.splitlines():
    parts = line.split("|")
    if len(parts) < 2:
        continue
    jobid      = parts[0].strip()
    user       = parts[1].strip()
    part       = parts[2].strip().rstrip("*") if len(parts) > 2 else ""
    part       = PARTITION_ALIASES.get(part, part)
    gres       = parts[3].strip() if len(parts) > 3 else ""
    reason     = parts[4].strip() if len(parts) > 4 else ""
    # %V is the submission time in the cluster's local timezone (Slurm prints
    # "N/A" if unknown). Convert to UTC so the frontend renders it correctly
    # regardless of the browser's timezone.
    submit_raw = parts[5].strip() if len(parts) > 5 else ""
    account    = parts[6].strip() if len(parts) > 6 else TEAM_ACCOUNT
    # %S is Slurm's scheduled/estimated start time - populated once the
    # scheduler has computed one (e.g. a BeginTime job, or a backfill
    # estimate); "N/A" means no estimate is available yet.
    start_raw  = parts[7].strip() if len(parts) > 7 else ""
    # %Q is the job's raw integer scheduling priority - higher runs sooner.
    priority_raw = parts[8].strip() if len(parts) > 8 else ""
    priority = int(priority_raw) if priority_raw.isdigit() else None
    queued_at = None
    if submit_raw and submit_raw != "N/A":
        try:
            local_dt = datetime.strptime(submit_raw, "%Y-%m-%dT%H:%M:%S")
            queued_at = local_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            queued_at = None
    scheduled_start = None
    if start_raw and start_raw != "N/A":
        try:
            local_dt = datetime.strptime(start_raw, "%Y-%m-%dT%H:%M:%S")
            scheduled_start = local_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            scheduled_start = None

    m = re.search(r"gpu:(?:([^:,\s\d][^:,\s]*):)?(\d+)", gres)
    gpu_type = m.group(1).upper() if m and m.group(1) else ""
    gpus = int(m.group(2)) if m else 0
    # Users often submit with a bare "--gres=gpu:N" (no type) but still pick a
    # partition. Each partition here maps 1:1 to a single GPU type, so that
    # still tells us the type unambiguously - fall back to it instead of
    # leaving gpu_type blank.
    if not gpu_type and part in PARTITIONS:
        gpu_type = part.upper()

    pending_jobs.append({"jobid": jobid, "user": user, "partition": part, "gpus_requested": gpus, "gpu_type": gpu_type, "reason": reason, "queued_at": queued_at, "scheduled_start": scheduled_start, "account": account, "priority": priority})
    pending_user_gpus[user] += gpus
    if account in team_account_pending_gpus:
        team_account_pending_gpus[account] += gpus

total_pending_gpus = sum(pending_user_gpus.values())

print(f"=== {TEAM_ACCOUNT} pending jobs: {len(pending_jobs)} ({total_pending_gpus} GPUs queued) ===")
if pending_jobs:
    print(f"{'USER':<15} {'JOB ID':>10} {'PARTITION':<15} {'GPUS':>6}")
    print(f"{'-------------':<15} {'------':>10} {'-------------':<15} {'-----':>6}")
    for j in sorted(pending_jobs, key=lambda x: x["user"]):
        print(f"{j['user']:<15} {j['jobid']:>10} {j['partition']:<15} {j['gpus_requested']:>6}")
print()


# ============================================================
# Section 4: Cluster-wide GPU usage by account (all accounts)
# ============================================================

all_accounts_out = run([
    "squeue", "-t", "R",
    # Partition width must exceed the longest partition name (e.g.
    # "rtx6000_condo", 13 chars) - squeue's fixed-width -O output runs a
    # column that overflows its declared width straight into the next
    # column with no separating space, corrupting the whitespace-split
    # parse below for any job in that partition.
    "-O", "UserName:20,Account:40,Partition:20,tres-alloc:100",
    "--noheader",
])

cluster_account_gpus = defaultdict(lambda: defaultdict(int))
cluster_account_user_gpus = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
for line in all_accounts_out.splitlines():
    fields = line.split()
    if len(fields) < 4:
        continue
    user    = fields[0].strip()
    account = fields[1].strip()
    part    = fields[2].strip().rstrip("*")
    part    = PARTITION_ALIASES.get(part, part)
    tres    = fields[3].strip()
    m = re.search(r"gres/gpu[^=,\s]*=(\d+)", tres)
    if m:
        gpus = int(m.group(1))
        cluster_account_gpus[account][part] += gpus
        cluster_account_user_gpus[account][user][part] += gpus


def acct_total(a):
    return sum(cluster_account_gpus[a].values())


all_queue_out = run([
    "squeue",
    "-O", "Account:40",
    "--noheader",
])
cluster_account_queue = defaultdict(int)
for line in all_queue_out.splitlines():
    account = line.strip()
    if account:
        cluster_account_queue[account] += 1

# Fold every team sub-account into the canonical "dkhasha1" row so the
# cluster-wide ranking (and the frontend's "which bar is us" logic) treats
# them as one team rather than several small, easy-to-miss accounts.
for acct in TEAM_ACCOUNTS:
    if acct == TEAM_ACCOUNT:
        continue
    if acct in cluster_account_gpus:
        for part, gpus in cluster_account_gpus.pop(acct).items():
            cluster_account_gpus[TEAM_ACCOUNT][part] += gpus
    if acct in cluster_account_queue:
        cluster_account_queue[TEAM_ACCOUNT] += cluster_account_queue.pop(acct)
    if acct in cluster_account_user_gpus:
        for user, part_gpus in cluster_account_user_gpus.pop(acct).items():
            for part, gpus in part_gpus.items():
                cluster_account_user_gpus[TEAM_ACCOUNT][user][part] += gpus

all_accounts_set = set(cluster_account_gpus.keys()) | set(cluster_account_queue.keys())
sorted_accounts = sorted(
    all_accounts_set,
    key=lambda a: (-acct_total(a), -cluster_account_queue[a]),
)

# ============================================================
# Section 5: Team queue throughput/wait time over a trailing window
# ============================================================

THROUGHPUT_WINDOW_HOURS = 24

sacct_out = run([
    # sacct defaults to showing only the invoking (SSH) user's own jobs,
    # unlike squeue - --allusers is required to see the whole team's jobs.
    "sacct", "--allusers", "--accounts=" + ",".join(TEAM_ACCOUNTS),
    "--starttime=now-{}hours".format(THROUGHPUT_WINDOW_HOURS), "--endtime=now",
    "-o", "JobID,Submit,Start,State,Partition,AllocTRES",
    "--noheader", "-P", "--allocations",
])

wait_seconds_samples = []
# (gpu_type, gpus_requested) -> [wait_seconds, ...], so we can see whether
# bigger requests (or a particular GPU type) wait longer than others.
bucket_wait_seconds = defaultdict(list)

for line in sacct_out.splitlines():
    parts = line.split("|")
    if len(parts) < 6:
        continue
    jobid, submit_raw, start_raw, state_raw, part_raw, alloc_tres = (p.strip() for p in parts[:6])
    if not jobid or "." in jobid:
        continue  # skip job-step sub-records (e.g. "12345.batch")
    if not start_raw or start_raw in ("Unknown", "None", ""):
        continue  # job never got allocated (still pending, or record incomplete)
    try:
        submit_dt = datetime.strptime(submit_raw, "%Y-%m-%dT%H:%M:%S")
        start_dt = datetime.strptime(start_raw, "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        continue
    wait = (start_dt - submit_dt).total_seconds()
    wait_seconds_samples.append(wait)

    part = PARTITION_ALIASES.get(part_raw.rstrip("*"), part_raw.rstrip("*"))
    m = re.search(r"gres/gpu[^=,\s]*=(\d+)", alloc_tres)
    if part in PARTITIONS and m:
        bucket_wait_seconds[(part, int(m.group(1)))].append(wait)

jobs_started = len(wait_seconds_samples)
# The mean is easily dragged around by a handful of jobs that waited days
# (a long tail is common here), so it doesn't represent a "typical" job's
# wait - report the median alongside it for that reason.
avg_wait_seconds = (sum(wait_seconds_samples) / jobs_started) if jobs_started else None
median_wait_seconds = statistics.median(wait_seconds_samples) if wait_seconds_samples else None
# Average time between one job starting and the next, i.e. 1/(start rate) -
# NOT the same thing as how long any individual job waited (that's avg/median
# wait above). Kept in time units so both throughput and wait read the same way.
avg_interstart_seconds = (
    (THROUGHPUT_WINDOW_HOURS * 3600 / jobs_started) if jobs_started else None
)

# Breakdown of wait time by what was actually requested (GPU type + count),
# to see whether bigger requests or a particular type wait longer.
by_request_size = sorted(
    (
        {
            "gpu_type": gpu_type,
            "gpus_requested": gpus,
            "count": len(samples),
            "avg_wait_seconds": sum(samples) / len(samples),
            "median_wait_seconds": statistics.median(samples),
        }
        for (gpu_type, gpus), samples in bucket_wait_seconds.items()
    ),
    key=lambda b: (PARTITIONS.index(b["gpu_type"]), b["gpus_requested"]),
)

# ============================================================
# JSON output
# ============================================================

report = {
    "timestamp": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    "server": "skipjack",
    "partitions": [
        {
            "partition": p,
            "total":     part_total[p],
            "used":      part_alloc[p],
            "idle":      part_idle[p],
            "down":      part_down[p],
            "allow_accounts": partition_access[p]["allow_accounts"],
            "deny_accounts":  partition_access[p]["deny_accounts"],
            "allow_qos":      partition_access[p]["allow_qos"],
            "deny_qos":       partition_access[p]["deny_qos"],
        }
        for p in PARTITIONS
    ],
    "partition_totals": {
        "total": grand_total,
        "used":  grand_alloc,
        "idle":  grand_idle,
        "down":  grand_down,
    },
    "dkhasha1_accounts": TEAM_ACCOUNTS,
    "fairshare": FAIRSHARE,
    "team_account_usage": [
        {
            "account": acct,
            "gpus": {p: g for p, g in team_account_gpus[acct].items() if g > 0},
            "total": sum(team_account_gpus[acct].values()),
            "pending_gpus": team_account_pending_gpus[acct],
            "capacity": TEAM_ACCOUNT_CAPS.get(acct),
        }
        for acct in sorted(
            TEAM_ACCOUNTS,
            key=lambda a: (-sum(team_account_gpus[a].values()), -team_account_pending_gpus[a]),
        )
    ],
    "dkhasha1_users": [
        {
            "user":  u,
            "gpus":  {p: user_gpus[p][u] for p in PARTITIONS if user_gpus[p][u] > 0},
            "total": user_total(u),
            "by_account": {a: g for a, g in user_account_gpus[u].items() if g > 0},
        }
        for u in sorted_users if user_total(u) > 0
    ],
    "dkhasha1_totals": {
        "by_partition": {p: part_totals[p] for p in PARTITIONS},
        "total": grand,
    },
    "pending_jobs": pending_jobs,
    "dkhasha1_pending": {
        "job_count": len(pending_jobs),
        "total_gpus_requested": total_pending_gpus,
        "by_user": [
            {"user": u, "gpus_requested": g}
            for u, g in sorted(pending_user_gpus.items(), key=lambda x: -x[1])
        ],
    },
    "cluster_account_usage": [
        {
            "account": a,
            "gpus": dict(cluster_account_gpus[a]),
            "total": acct_total(a),
            "queue": cluster_account_queue[a],
            "users": sorted(
                (
                    {
                        "user": u,
                        "gpus": {p: g for p, g in part_gpus.items() if g > 0},
                        "total": sum(part_gpus.values()),
                    }
                    for u, part_gpus in cluster_account_user_gpus[a].items()
                ),
                key=lambda x: -x["total"],
            ),
        }
        for a in sorted_accounts if acct_total(a) > 0 or cluster_account_queue[a] > 0
    ],
    "throughput": {
        "window_hours": THROUGHPUT_WINDOW_HOURS,
        "jobs_started": jobs_started,
        "avg_wait_seconds": avg_wait_seconds,
        "median_wait_seconds": median_wait_seconds,
        "avg_interstart_seconds": avg_interstart_seconds,
        "by_request_size": by_request_size,
    },
}

print(json.dumps(report, indent=2))
