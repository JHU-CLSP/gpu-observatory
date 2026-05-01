#!/usr/bin/env python3
"""GPU usage dashboard for SLURM cluster.
Shows idle GPUs, per-user usage, and dkhasha1 group totals.

Run locally — if SLURM tools aren't found, re-executes itself on the
dsai remote server via SSH automatically.
"""

import json
import os
import re
import subprocess
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

REMOTE = "dsai"

if os.environ.get("_GPUSTATS_ON_REMOTE") != "1":
    sys.exit(subprocess.run(
        ["ssh", REMOTE, "env", "_GPUSTATS_ON_REMOTE=1", "python3", "-"],
        stdin=open(__file__)
    ).returncode)

PARTITIONS = ["a100", "h100", "nvl", "l40s"]

_t0 = time.time()

def log(msg):
    elapsed = time.time() - _t0
    print(f"[dsai +{elapsed:5.1f}s] {msg}", file=sys.stderr, flush=True)


def run(cmd):
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
    return result.stdout


# ============================================================
# Section 1: Idle GPUs per partition
# ============================================================

# Map nodes to partitions via sinfo.
# h200 is queried separately because it is not in the default sinfo output.
log("Section 1: querying sinfo for node-partition map...")
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

log("Section 1: running scontrol show node...")
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

    if "Gres=" in line and "AllocTRES" not in line and "CfgTRES" not in line:
        m = re.search(r"gpu:[^,()\s]*", line)
        if m:
            count = re.search(r"\d+$", m.group())
            if count:
                current_gres_total = int(count.group())

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

log("Section 2: querying dkhasha1 running jobs...")
user_gpus = {part: defaultdict(int) for part in PARTITIONS}
users_seen = []

squeue_out = run([
    "squeue",
    "-O", "JobID:12,UserName:20,Partition:10,tres-alloc:100,Account:20",
    "--account=dkhasha1",
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

# Sort users by total GPU usage descending
def user_total(u):
    return sum(user_gpus[p][u] for p in PARTITIONS)

sorted_users = sorted(users_seen, key=user_total, reverse=True)

print()
col_headers = [p.upper() for p in PARTITIONS]
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

log("Section 3: querying interactive jobs...")
INTERACTIVE_NAMES = {"bash", "sh", "zsh", "fish", "interactive",
                     "python", "python3", "ipython", "jupyter", "singularity_shell"}

iqueue_out = run([
    "squeue",
    "-O", "JobID:12,UserName:20,Partition:10,Name:40,tres-alloc:100",
    "--account=dkhasha1",
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
# Section 4: Idle-allocated GPUs (dkhasha1 team)
# Finds GPUs our team has allocated but is not actively using.
# ============================================================

log("Section 4: querying node lists for idle GPU check...")
squeue_nodes_out = run([
    "squeue",
    "-O", "JobID:12,UserName:20,NodeList:100,tres-alloc:100",
    "--account=dkhasha1",
    "-t", "R",
    "--noheader",
])

node_to_users = defaultdict(set)  # node -> set of users with GPU jobs there
for line in squeue_nodes_out.splitlines():
    fields = line.split()
    if len(fields) < 3:
        continue
    user     = fields[1].strip()
    nodelist = fields[2].strip()
    tres     = fields[3].strip() if len(fields) > 3 else ""
    m = re.search(r"gres/gpu=(\d+)", tres)
    if not m or int(m.group(1)) == 0:
        continue
    # Expand compact SLURM node list e.g. "gpu[01-03]" -> ["gpu01","gpu02","gpu03"]
    expanded = run(["scontrol", "show", "hostnames", nodelist]).split()
    for node in expanded:
        if node:
            node_to_users[node].add(user)

idle_allocated_gpus = []  # {node, gpu_index, util_pct, users}

log(f"Section 4: SSHing into {len(node_to_users)} nodes to check nvidia-smi...")
for node, users in sorted(node_to_users.items()):
    log(f"  ssh {node} nvidia-smi...")
    cmd = (
        "nvidia-smi --query-gpu=index,utilization.gpu,uuid --format=csv,noheader,nounits 2>/dev/null; "
        "echo '---SEP---'; "
        "nvidia-smi --query-compute-apps=gpu_uuid,used_memory --format=csv,noheader,nounits 2>/dev/null"
    )
    out = run(["ssh",
               "-o", "StrictHostKeyChecking=no",
               "-o", "ConnectTimeout=5",
               "-o", "BatchMode=yes",
               node, cmd])

    if "---SEP---" not in out:
        continue  # SSH failed or nvidia-smi not available

    gpu_part, apps_part = out.split("---SEP---", 1)

    # Parse GPU info: index -> {util_pct, uuid}
    gpu_info = {}
    for gline in gpu_part.strip().splitlines():
        parts = [p.strip() for p in gline.split(",")]
        if len(parts) < 3:
            continue
        try:
            gpu_info[int(parts[0])] = {"util_pct": int(parts[1]), "uuid": parts[2]}
        except ValueError:
            continue

    # UUIDs that have active compute processes
    active_uuids = set()
    for aline in apps_part.strip().splitlines():
        parts = [p.strip() for p in aline.split(",")]
        if parts and parts[0]:
            active_uuids.add(parts[0])

    uuid_to_idx = {v["uuid"]: k for k, v in gpu_info.items()}

    for uuid in active_uuids:
        idx = uuid_to_idx.get(uuid)
        if idx is not None and gpu_info[idx]["util_pct"] == 0:
            idle_allocated_gpus.append({
                "node":      node,
                "gpu_index": idx,
                "util_pct":  0,
                "users":     sorted(users),
            })

idle_allocated_gpus.sort(key=lambda x: (x["node"], x["gpu_index"]))

print()
if idle_allocated_gpus:
    print(f"=== dkhasha1 idle-allocated GPUs: {len(idle_allocated_gpus)} ===")
    print(f"{'NODE':<20} {'GPU':>4}  {'USERS'}")
    print(f"{'-------------------':<20} {'---':>4}  {'-----'}")
    for g in idle_allocated_gpus:
        print(f"{g['node']:<20} {g['gpu_index']:>4}  {','.join(g['users'])}")
else:
    print("=== dkhasha1 idle-allocated GPUs: none ===")

# ============================================================
# Section 5: Pending jobs (dkhasha1 account)
# ============================================================

log("Section 5: querying pending jobs...")
pending_out = run([
    "squeue",
    "-o", "%i|%u|%P|%b|%r",
    "--account=dkhasha1",
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

print()
print(f"=== dkhasha1 pending jobs: {len(pending_jobs)} ({total_pending_gpus} GPUs queued) ===")
if pending_jobs:
    print(f"{'USER':<15} {'JOB ID':>10} {'PARTITION':<15} {'GPUS':>6}")
    print(f"{'-------------':<15} {'------':>10} {'-------------':<15} {'-----':>6}")
    for j in sorted(pending_jobs, key=lambda x: x["user"]):
        print(f"{j['user']:<15} {j['jobid']:>10} {j['partition']:<15} {j['gpus_requested']:>6}")
print()

# ============================================================
# Section 6: H200 partition
# Not visible in default sinfo; queried explicitly via -p h200.
# Team allocation limit: 24 GPUs.
# ============================================================

H200_TEAM_LIMIT = 24

# Per-node state for H200 nodes.
GPUS_PER_H200_NODE = 4
log("Section 6: querying H200 partition...")
h200_node_state_out = run(["sinfo", "-p", "h200", "-o", "%n %T", "--noheader"])
h200_nodes = []
for line in h200_node_state_out.splitlines():
    parts = line.split()
    if len(parts) < 2:
        continue
    h200_nodes.append({"node": parts[0].strip(), "state": parts[1].strip()})

h200_node_total = sum(
    GPUS_PER_H200_NODE for n in h200_nodes
    if not re.search(r"down|drain|not_resp|maint", n["state"], re.IGNORECASE)
)

# All running jobs on h200 (any account)
h200_run_out = run([
    "squeue", "-p", "h200", "-t", "R",
    "-O", "JobID:12,UserName:20,Account:20,tres-alloc:100",
    "--noheader",
])

h200_running_jobs = []
h200_team_gpus_used = 0
h200_total_gpus_used = 0

for line in h200_run_out.splitlines():
    fields = line.split()
    if len(fields) < 3:
        continue
    jobid   = fields[0].strip()
    user    = fields[1].strip()
    account = fields[2].strip()
    tres    = fields[3].strip() if len(fields) > 3 else ""

    # Handle both gres/gpu=N and gres/gpu:h200=N (named GPU type)
    m = re.search(r"gres/gpu[^=,\s]*=(\d+)", tres)
    gpus = int(m.group(1)) if m else 0

    h200_running_jobs.append({"jobid": jobid, "user": user, "account": account, "gpus": gpus})
    h200_total_gpus_used += gpus
    if account == "dkhasha1":
        h200_team_gpus_used += gpus

# Pending jobs for dkhasha1 on h200.
# Use pipe-delimited short format: %b gives the gres binding (e.g. gpu:h200:8),
# which is more reliable than tres-req for GPU counts on pending jobs.
h200_pend_out = run([
    "squeue", "-p", "h200", "-t", "PD",
    "--account=dkhasha1",
    "-o", "%i|%u|%b|%r",
    "--noheader",
])

h200_pending_jobs = []
h200_pending_user_gpus = defaultdict(int)

for line in h200_pend_out.splitlines():
    parts = line.split("|")
    if len(parts) < 2:
        continue
    jobid  = parts[0].strip()
    user   = parts[1].strip()
    gres   = parts[2].strip() if len(parts) > 2 else ""   # e.g. "gpu:h200:8"
    reason = parts[3].strip() if len(parts) > 3 else ""

    # gres binding format: "gpu:h200:8" or "gpu:8"
    m = re.search(r"gpu(?::[^:,\s]+)*:(\d+)", gres)
    gpus = int(m.group(1)) if m else 0

    h200_pending_jobs.append({"jobid": jobid, "user": user, "gpus_requested": gpus, "reason": reason})
    h200_pending_user_gpus[user] += gpus

h200_total_pending_gpus = sum(h200_pending_user_gpus.values())

print()
print(f"=== H200: team {h200_team_gpus_used}/{H200_TEAM_LIMIT} GPUs  |  cluster {h200_total_gpus_used}/{h200_node_total} GPUs ===")
if h200_running_jobs:
    print(f"{'USER':<15} {'JOB ID':>10} {'ACCOUNT':<15} {'GPUS':>6}")
    print(f"{'-------------':<15} {'------':>10} {'-------------':<15} {'-----':>6}")
    for j in sorted(h200_running_jobs, key=lambda x: x["user"]):
        print(f"{j['user']:<15} {j['jobid']:>10} {j['account']:<15} {j['gpus']:>6}")
if h200_pending_jobs:
    print(f"  Pending (dkhasha1): {len(h200_pending_jobs)} jobs, {h200_total_pending_gpus} GPUs queued")
print()

# ============================================================
# Section 6b: B200 partition (-p b200)
# ============================================================

log("Section 6b: querying B200 (partition b200)...")

b200_node_state_out = run(["sinfo", "-p", "b200", "-o", "%n|%T|%G", "--noheader"])
b200_nodes = []
b200_node_total = 0
for line in b200_node_state_out.splitlines():
    parts = line.split("|")
    if len(parts) < 2:
        continue
    node  = parts[0].strip()
    state = parts[1].strip()
    gres  = parts[2].strip() if len(parts) > 2 else ""
    m = re.search(r"gpu[^:]*(?::[^:,\s]+)*:(\d+)", gres)
    gpus_on_node = int(m.group(1)) if m else 0
    b200_nodes.append({"node": node, "state": state})
    if not re.search(r"down|drain|not_resp|maint", state, re.IGNORECASE):
        b200_node_total += gpus_on_node

b200_run_out = run([
    "squeue", "-p", "b200", "-t", "R",
    "-O", "JobID:12,UserName:20,Account:20,tres-alloc:100",
    "--noheader",
])

b200_running_jobs = []
b200_team_gpus_used = 0
b200_total_gpus_used = 0

for line in b200_run_out.splitlines():
    fields = line.split()
    if len(fields) < 3:
        continue
    jobid   = fields[0].strip()
    user    = fields[1].strip()
    account = fields[2].strip()
    tres    = fields[3].strip() if len(fields) > 3 else ""
    m = re.search(r"gres/gpu[^=,\s]*=(\d+)", tres)
    gpus = int(m.group(1)) if m else 0
    b200_running_jobs.append({"jobid": jobid, "user": user, "account": account, "gpus": gpus})
    b200_total_gpus_used += gpus
    if account == "dkhasha1":
        b200_team_gpus_used += gpus

b200_pend_out = run([
    "squeue", "-p", "b200", "-t", "PD",
    "--account=dkhasha1",
    "-o", "%i|%u|%b|%r",
    "--noheader",
])

b200_pending_jobs = []
b200_pending_user_gpus = defaultdict(int)

for line in b200_pend_out.splitlines():
    parts = line.split("|")
    if len(parts) < 2:
        continue
    jobid  = parts[0].strip()
    user   = parts[1].strip()
    gres   = parts[2].strip() if len(parts) > 2 else ""
    reason = parts[3].strip() if len(parts) > 3 else ""
    m = re.search(r"gpu(?::[^:,\s]+)*:(\d+)", gres)
    gpus = int(m.group(1)) if m else 0
    b200_pending_jobs.append({"jobid": jobid, "user": user, "gpus_requested": gpus, "reason": reason})
    b200_pending_user_gpus[user] += gpus

b200_total_pending_gpus = sum(b200_pending_user_gpus.values())

print()
print(f"=== B200: team {b200_team_gpus_used} GPUs  |  cluster {b200_total_gpus_used}/{b200_node_total} GPUs ===")
if b200_running_jobs:
    print(f"{'USER':<15} {'JOB ID':>10} {'ACCOUNT':<15} {'GPUS':>6}")
    print(f"{'-------------':<15} {'------':>10} {'-------------':<15} {'-----':>6}")
    for j in sorted(b200_running_jobs, key=lambda x: x["user"]):
        print(f"{j['user']:<15} {j['jobid']:>10} {j['account']:<15} {j['gpus']:>6}")
if b200_pending_jobs:
    print(f"  Pending (dkhasha1): {len(b200_pending_jobs)} jobs, {b200_total_pending_gpus} GPUs queued")
print()

# ============================================================
# Section 7: Cluster-wide GPU usage by account
# ============================================================

log("Section 7: querying cluster-wide account usage...")
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
    m = re.search(r"gres/gpu=(\d+)", tres)
    if m:
        cluster_account_gpus[account][part] += int(m.group(1))

def acct_total(a):
    return sum(cluster_account_gpus[a].values())

sorted_accounts = sorted(cluster_account_gpus, key=acct_total, reverse=True)

# ============================================================
# Scratch space
# ============================================================

def parse_size_tb(s):
    """Parse a size string like '68.75 TB' or '100.00 GB' into float TB."""
    m = re.match(r"([\d.]+)\s*(TB|GB)", s.strip())
    if not m:
        return 0.0
    val = float(m.group(1))
    return val if m.group(2) == "TB" else round(val / 1024, 2)


def get_scratch_space_tb(fs_path="/scratch/dkhasha1/"):
    """Parse scratch quota from quotas.py output (DSAI GPFS table)."""
    out = run(["/weka/apps/helpers/quotas.py"])
    for line in out.splitlines():
        cols = [c.strip() for c in line.split("|")]
        cols = [c for c in cols if c]
        if len(cols) >= 3 and cols[0] == fs_path:
            return parse_size_tb(cols[2]), parse_size_tb(cols[1])  # total, used
    return 0.0, 0.0


log("Scratch: running quotas.py...")
try:
    scratch_total_tb, scratch_used_tb = get_scratch_space_tb("/scratch/dkhasha1/")
    print(f"Scratch /scratch/dkhasha1: {scratch_used_tb} TB used / {scratch_total_tb} TB total")
except Exception as e:
    scratch_total_tb, scratch_used_tb = None, None
    print(f"Scratch /scratch/dkhasha1: unavailable ({e})")

# ============================================================
# JSON output
# ============================================================

report = {
    "timestamp": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    "server": "dsai",
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
    "idle_allocated_gpus": idle_allocated_gpus,
    "pending_jobs": pending_jobs,
    "dkhasha1_pending": {
        "job_count": len(pending_jobs),
        "total_gpus_requested": total_pending_gpus,
        "by_user": [
            {"user": u, "gpus_requested": g}
            for u, g in sorted(pending_user_gpus.items(), key=lambda x: -x[1])
        ],
    },
    "h200": {
        "team_limit": H200_TEAM_LIMIT,
        "team_gpus_used": h200_team_gpus_used,
        "total_gpus_used": h200_total_gpus_used,
        "total_gpus_available": h200_node_total,
        "nodes": h200_nodes,
        "running_jobs": h200_running_jobs,
        "pending_jobs": h200_pending_jobs,
        "pending_summary": {
            "job_count": len(h200_pending_jobs),
            "total_gpus_requested": h200_total_pending_gpus,
            "by_user": [
                {"user": u, "gpus_requested": g}
                for u, g in sorted(h200_pending_user_gpus.items(), key=lambda x: -x[1])
            ],
        },
    },
    "b200": {
        "team_gpus_used": b200_team_gpus_used,
        "total_gpus_used": b200_total_gpus_used,
        "total_gpus_available": b200_node_total,
        "nodes": b200_nodes,
        "running_jobs": b200_running_jobs,
        "pending_jobs": b200_pending_jobs,
        "pending_summary": {
            "job_count": len(b200_pending_jobs),
            "total_gpus_requested": b200_total_pending_gpus,
            "by_user": [
                {"user": u, "gpus_requested": g}
                for u, g in sorted(b200_pending_user_gpus.items(), key=lambda x: -x[1])
            ],
        },
    },
    "cluster_account_usage": [
        {
            "account": a,
            "gpus": dict(cluster_account_gpus[a]),
            "total": acct_total(a),
        }
        for a in sorted_accounts if acct_total(a) > 0
    ],
    "scratch_space_total_tb": scratch_total_tb,
    "scratch_space_used_tb":  scratch_used_tb,
}

log(f"Done. Total elapsed: {time.time() - _t0:.1f}s")
print(json.dumps(report, indent=2))