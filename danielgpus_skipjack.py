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
PARTITIONS = ["a100", "b200", "b300", "h100", "h200", "l40s"]
TEAM_ACCOUNT = "dkhasha1"

# Skipjack's node states include "drng" (draining) in addition to the
# down|drain|not_resp|maint states seen on dsai/rockfish.
DOWN_STATE_RE = r"down|drain|drng|not_resp|maint|fail"


def run(cmd):
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
    return result.stdout


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
    # so CfgTRES/AllocTRES parsing mirrors danielgpus_rockfish.py.
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
users_seen = []

squeue_out = run([
    "squeue",
    "-O", "JobID:12,UserName:20,Partition:10,tres-alloc:100,Account:20",
    "--account=" + TEAM_ACCOUNT,
    "-t", "R",
    "--noheader",
])

for line in squeue_out.splitlines():
    fields = line.split()
    if len(fields) < 3:
        continue
    user = fields[1].strip()
    part = fields[2].strip().rstrip("*")
    tres = fields[3].strip() if len(fields) > 3 else ""

    if part not in PARTITIONS:
        continue

    m = re.search(r"gres/gpu[^=,\s]*=(\d+)", tres)
    gpus = int(m.group(1)) if m else 0

    if user not in users_seen:
        users_seen.append(user)

    user_gpus[part][user] += gpus


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
    "-o", "%i|%u|%P|%b|%r|%V",
    "--account=" + TEAM_ACCOUNT,
    "-t", "PD",
    "--noheader",
])

pending_jobs = []
pending_user_gpus = defaultdict(int)

for line in pending_out.splitlines():
    parts = line.split("|")
    if len(parts) < 2:
        continue
    jobid      = parts[0].strip()
    user       = parts[1].strip()
    part       = parts[2].strip().rstrip("*") if len(parts) > 2 else ""
    gres       = parts[3].strip() if len(parts) > 3 else ""
    reason     = parts[4].strip() if len(parts) > 4 else ""
    # %V is the submission time in the cluster's local timezone (Slurm prints
    # "N/A" if unknown). Convert to UTC so the frontend renders it correctly
    # regardless of the browser's timezone.
    submit_raw = parts[5].strip() if len(parts) > 5 else ""
    queued_at = None
    if submit_raw and submit_raw != "N/A":
        try:
            local_dt = datetime.strptime(submit_raw, "%Y-%m-%dT%H:%M:%S")
            queued_at = local_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            queued_at = None

    m = re.search(r"gpu:(?:([^:,\s\d][^:,\s]*):)?(\d+)", gres)
    gpu_type = m.group(1).upper() if m and m.group(1) else ""
    gpus = int(m.group(2)) if m else 0

    pending_jobs.append({"jobid": jobid, "user": user, "partition": part, "gpus_requested": gpus, "gpu_type": gpu_type, "reason": reason, "queued_at": queued_at})
    pending_user_gpus[user] += gpus

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
    "-O", "Account:40,Partition:15,tres-alloc:100",
    "--noheader",
])

cluster_account_gpus = defaultdict(lambda: defaultdict(int))
for line in all_accounts_out.splitlines():
    fields = line.split()
    if len(fields) < 3:
        continue
    account = fields[0].strip()
    part    = fields[1].strip().rstrip("*")
    tres    = fields[2].strip()
    m = re.search(r"gres/gpu[^=,\s]*=(\d+)", tres)
    if m:
        cluster_account_gpus[account][part] += int(m.group(1))


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

all_accounts_set = set(cluster_account_gpus.keys()) | set(cluster_account_queue.keys())
sorted_accounts = sorted(
    all_accounts_set,
    key=lambda a: (-acct_total(a), -cluster_account_queue[a]),
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
    "dkhasha1_users": [
        {
            "user":  u,
            "gpus":  {p: user_gpus[p][u] for p in PARTITIONS if user_gpus[p][u] > 0},
            "total": user_total(u),
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
        }
        for a in sorted_accounts if acct_total(a) > 0 or cluster_account_queue[a] > 0
    ],
}

print(json.dumps(report, indent=2))
