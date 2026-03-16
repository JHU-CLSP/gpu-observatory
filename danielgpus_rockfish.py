#!/usr/bin/env python3
"""GPU usage dashboard for Rockfish SLURM cluster.
Shows idle GPUs, per-user usage, and dkhasha1 group totals.

Run locally — if SLURM tools aren't found, re-executes itself on the
rockfish remote server via SSH automatically.
"""

import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from datetime import datetime

REMOTE = "rockfish"

if os.environ.get("_GPUSTATS_ON_REMOTE") != "1":
    sys.exit(subprocess.run(
        ["ssh", REMOTE, "env", "_GPUSTATS_ON_REMOTE=1", "python3", "-"],
        stdin=open(__file__)
    ).returncode)

PARTITIONS = ["a100", "ica100", "l40s", "v100"]
TEAM_ACCOUNTS = ["danielk_gpu", "danielk", "danielk80_gpu", "dk-clsp_gpu"]


def run(cmd):
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
    return result.stdout


# ============================================================
# Section 1: Idle GPUs per partition
# ============================================================

# Map nodes to partitions via sinfo
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
    if re.search(r"down|drain|not_resp|maint", current_state, re.IGNORECASE):
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

    # Prefer CfgTRES for total GPU count (more reliable on Rockfish)
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
print(f"{'PARTITION':<12} {'TOTAL':>6} {'USED':>6} {'IDLE':>6} {'DOWN':>6}")
print(f"{'----------':<12} {'-----':>6} {'-----':>6} {'-----':>6} {'-----':>6}")

grand_total = grand_alloc = grand_idle = grand_down = 0
for part in PARTITIONS:
    t, a, i, d = part_total[part], part_alloc[part], part_idle[part], part_down[part]
    print(f"{part:<12} {t:>6} {a:>6} {i:>6} {d:>6}")
    grand_total += t; grand_alloc += a; grand_idle += i; grand_down += d

print(f"{'----------':<12} {'-----':>6} {'-----':>6} {'-----':>6} {'-----':>6}")
print(f"{'TOTAL':<12} {grand_total:>6} {grand_alloc:>6} {grand_idle:>6} {grand_down:>6}")


# ============================================================
# Section 2: dkhasha1 account GPU usage
# ============================================================

user_gpus = {part: defaultdict(int) for part in PARTITIONS}
users_seen = []

squeue_out = run([
    "squeue",
    "-O", "JobID:12,UserName:20,Partition:15,tres-alloc:100,Account:20",
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
    tres = fields[3].strip() if len(fields) > 3 else ""

    if part not in PARTITIONS:
        continue

    m = re.search(r"gres/gpu=(\d+)", tres)
    gpus = int(m.group(1)) if m else 0

    if user not in users_seen:
        users_seen.append(user)

    user_gpus[part][user] += gpus


def user_total(u):
    return sum(user_gpus[p][u] for p in PARTITIONS)


sorted_users = sorted(users_seen, key=user_total, reverse=True)

# Dynamic headers based on PARTITIONS
col_headers = [p.upper() for p in PARTITIONS]
print()
print("=== dkhasha1 account GPU usage ===")
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
# Section 3: Interactive jobs (dkhasha1 account)
# ============================================================

INTERACTIVE_NAMES = {"bash", "sh", "zsh", "fish", "interactive",
                     "python", "python3", "ipython", "jupyter", "singularity_shell"}

iqueue_out = run([
    "squeue",
    "-O", "JobID:12,UserName:20,Partition:10,Name:40,tres-alloc:100",
    "--account=" + ",".join(TEAM_ACCOUNTS),
    "-t", "R",
    "--noheader",
])

interactive_jobs = []
for line in iqueue_out.splitlines():
    fields = line.split()
    if len(fields) < 4:
        continue
    jobid = fields[0].strip()
    user  = fields[1].strip()
    part  = fields[2].strip().rstrip("*")
    name  = fields[3].strip().lower()
    tres  = fields[4].strip() if len(fields) > 4 else ""

    if name in INTERACTIVE_NAMES:
        m = re.search(r"gres/gpu=(\d+)", tres)
        gpus = int(m.group(1)) if m else 0
        if gpus > 0:
            interactive_jobs.append({"jobid": jobid, "user": user, "partition": part, "name": name, "gpus": gpus})

print(f"=== dkhasha1 interactive jobs: {len(interactive_jobs)} ===")
if interactive_jobs:
    print(f"{'USER':<15} {'JOB ID':>10} {'PARTITION':<12} {'SHELL':<20} {'GPUS':>6}")
    print(f"{'-------------':<15} {'------':>10} {'----------':<12} {'-------------------':<20} {'-----':>6}")
    for j in sorted(interactive_jobs, key=lambda x: x["user"]):
        print(f"{j['user']:<15} {j['jobid']:>10} {j['partition']:<12} {j['name']:<20} {j['gpus']:>6}")
print()

# ============================================================
# Section 4: Pending jobs (dkhasha1 account)
# ============================================================

pending_out = run([
    "squeue",
    "-o", "%i|%u|%P|%b|%r",
    "--account=" + ",".join(TEAM_ACCOUNTS),
    "-t", "PD",
    "--noheader",
])

pending_jobs = []
pending_user_gpus = defaultdict(int)  # user -> total GPUs requested

for line in pending_out.splitlines():
    parts = line.split("|")
    if len(parts) < 2:
        continue
    jobid  = parts[0].strip()
    user   = parts[1].strip()
    part   = parts[2].strip().rstrip("*") if len(parts) > 2 else ""
    gres   = parts[3].strip() if len(parts) > 3 else ""
    reason = parts[4].strip() if len(parts) > 4 else ""

    m = re.search(r"gpu:(?:([^:,\s\d][^:,\s]*):)?(\d+)", gres)
    gpu_type = m.group(1).upper() if m and m.group(1) else ""
    gpus = int(m.group(2)) if m else 0

    pending_jobs.append({"jobid": jobid, "user": user, "partition": part, "gpus_requested": gpus, "gpu_type": gpu_type, "reason": reason})
    pending_user_gpus[user] += gpus

total_pending_gpus = sum(pending_user_gpus.values())

print(f"=== dkhasha1 pending jobs: {len(pending_jobs)} ({total_pending_gpus} GPUs queued) ===")
if pending_jobs:
    print(f"{'USER':<15} {'JOB ID':>10} {'PARTITION':<15} {'GPUS':>6}")
    print(f"{'-------------':<15} {'------':>10} {'-------------':<15} {'-----':>6}")
    for j in sorted(pending_jobs, key=lambda x: x["user"]):
        print(f"{j['user']:<15} {j['jobid']:>10} {j['partition']:<15} {j['gpus_requested']:>6}")
print()

# ============================================================
# Scratch space
# ============================================================

def parse_size_tb(s):
    """Parse a size string like '7.58 TB' or '746.72 GB' into float TB."""
    m = re.match(r"([\d.]+)\s*(TB|GB)", s.strip())
    if not m:
        return 0.0
    val = float(m.group(1))
    return val if m.group(2) == "TB" else round(val / 1024, 2)


def get_scratch_space_tb(fs_name="scratch4"):
    """Parse scratch quota from quotas.py output (Rockfish GPFS table)."""
    out = run(["quotas.py"])
    for line in out.splitlines():
        cols = [c.strip() for c in line.split("|")]
        cols = [c for c in cols if c]  # drop empty
        if len(cols) >= 3 and cols[0] == fs_name:
            return parse_size_tb(cols[2]), parse_size_tb(cols[1])  # total, used
    return 0.0, 0.0


try:
    scratch_total_tb, scratch_used_tb = get_scratch_space_tb("scratch4")
    print(f"Scratch scratch4: {scratch_used_tb} TB used / {scratch_total_tb} TB total")
except Exception as e:
    scratch_total_tb, scratch_used_tb = None, None
    print(f"Scratch scratch4: unavailable ({e})")

# ============================================================
# JSON output
# ============================================================

report = {
    "timestamp": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    "server": "rockfish",
    "partitions": [
        {
            "partition": p,
            "total":     part_total[p],
            "used":      part_alloc[p],
            "idle":      part_idle[p],
            "down":      part_down[p],
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
    "interactive_jobs": interactive_jobs,
    "pending_jobs": pending_jobs,
    "dkhasha1_pending": {
        "job_count": len(pending_jobs),
        "total_gpus_requested": total_pending_gpus,
        "by_user": [
            {"user": u, "gpus_requested": g}
            for u, g in sorted(pending_user_gpus.items(), key=lambda x: -x[1])
        ],
    },
    "scratch_space_total_tb": scratch_total_tb,
    "scratch_space_used_tb":  scratch_used_tb,
}

print(json.dumps(report, indent=2))
