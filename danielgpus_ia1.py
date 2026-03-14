#!/usr/bin/env python3
"""GPU usage dashboard for ia1 single-node server (10x A6000).
Shows per-GPU utilization, memory, and per-user GPU usage.

Run locally — if nvidia-smi isn't found, re-executes itself on the
ia1 remote server via SSH automatically.
"""

import json
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from datetime import datetime

REMOTE = "ia1"

if not shutil.which("nvidia-smi"):
    sys.exit(subprocess.run(["ssh", REMOTE, "python3", "-"], stdin=open(__file__)).returncode)


def run(cmd):
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
    return result.stdout


# ============================================================
# Section 1: Per-GPU stats
# ============================================================

smi_out = run([
    "nvidia-smi",
    "--query-gpu=index,name,utilization.gpu,memory.used,memory.total,memory.free",
    "--format=csv,noheader,nounits",
])

gpus = []
for line in smi_out.strip().splitlines():
    parts = [p.strip() for p in line.split(",")]
    if len(parts) < 6:
        continue
    gpus.append({
        "index":    int(parts[0]),
        "name":     parts[1],
        "util_pct": int(parts[2]),
        "mem_used": int(parts[3]),
        "mem_total":int(parts[4]),
        "mem_free": int(parts[5]),
    })

print()
print(f"{'GPU':<4} {'NAME':<20} {'UTIL':>6}")
print(f"{'---':<4} {'--------------------':<20} {'------':>6}")

total_used = total_free = total_mem = 0
for g in gpus:
    print(f"{g['index']:<4} {g['name']:<20} {g['util_pct']:>5}%")
    total_used += g["mem_used"]
    total_free += g["mem_free"]
    total_mem  += g["mem_total"]

print(f"{'---':<4} {'--------------------':<20} {'------':>6}")

gpu_util = {g["index"]: g["util_pct"] for g in gpus}  # used later


# ============================================================
# Section 2: Per-user GPU memory usage
# ============================================================

# Get running compute processes: pid, gpu_uuid, used_memory
apps_out = run([
    "nvidia-smi",
    "--query-compute-apps=pid,gpu_uuid,used_memory",
    "--format=csv,noheader,nounits",
])

# Build gpu_uuid -> index map
uuid_out = run([
    "nvidia-smi",
    "--query-gpu=index,uuid",
    "--format=csv,noheader",
])
uuid_to_idx = {}
for line in uuid_out.strip().splitlines():
    parts = [p.strip() for p in line.split(",")]
    if len(parts) == 2:
        uuid_to_idx[parts[1]] = int(parts[0])

# Resolve pid -> username via ps
def pid_to_user(pid):
    out = run(["ps", "-o", "user=", "-p", str(pid)])
    return out.strip() or "unknown"

user_gpu_mem = defaultdict(lambda: defaultdict(int))  # user -> gpu_idx -> mem_mb
user_procs   = defaultdict(int)                        # user -> process count

for line in apps_out.strip().splitlines():
    parts = [p.strip() for p in line.split(",")]
    if len(parts) < 3:
        continue
    pid  = parts[0]
    uuid = parts[1]
    mem  = re.sub(r"[^\d]", "", parts[2])
    mem  = int(mem) if mem else 0

    gpu_idx = uuid_to_idx.get(uuid, -1)
    user    = pid_to_user(pid)
    user_gpu_mem[user][gpu_idx] += mem
    user_procs[user] += 1

# Build gpu_idx -> user map (for idle-but-allocated reporting)
gpu_to_user = {}
for user, gpu_map in user_gpu_mem.items():
    for gpu_idx in gpu_map:
        gpu_to_user[gpu_idx] = user

allocated_gpus = len(gpu_to_user)
active_gpus    = sum(1 for idx in gpu_to_user if gpu_util.get(idx, 0) > 0)
total_gpus     = len(gpus)

print()
print(f"=== GPU summary: {allocated_gpus}/{total_gpus} allocated, {active_gpus}/{total_gpus} actively utilized ===")

if user_gpu_mem:
    print()
    print("=== Per-user GPU memory usage ===")
    print(f"{'USER':<15} {'PROCS':>6} {'MEM USED':>10} {'GPUS'}")
    print(f"{'-------------':<15} {'-----':>6} {'--------':>10} {'----'}")

    for user, gpu_map in sorted(user_gpu_mem.items(), key=lambda x: -sum(x[1].values())):
        total_user_mem = sum(gpu_map.values())
        gpu_list = ",".join(str(g) for g in sorted(gpu_map))
        print(f"{user:<15} {user_procs[user]:>6} {total_user_mem:>8}MB  {gpu_list}")
else:
    print()
    print("=== Per-user GPU memory usage ===")
    print("  No active GPU processes.")

# Allocated but idle GPUs (0% utilization with processes)
idle_allocated = [(idx, gpu_to_user[idx]) for idx in sorted(gpu_to_user) if gpu_util.get(idx, 0) == 0]
print()
if idle_allocated:
    print("=== Allocated but idle GPUs (0% utilization) ===")
    print(f"{'GPU':<6} {'USER'}")
    print(f"{'---':<6} {'-------------'}")
    for idx, user in idle_allocated:
        print(f"{idx:<6} {user}")
else:
    print("=== Allocated but idle GPUs: none ===")

print()

# ============================================================
# JSON output
# ============================================================

report = {
    "timestamp": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    "server": "ia1",
    "summary": {
        "total_gpus":     total_gpus,
        "allocated_gpus": allocated_gpus,
        "active_gpus":    active_gpus,
        "idle_allocated": len(idle_allocated),
        "total_mem_mb":   total_mem,
        "total_mem_used_mb": total_used,
        "total_mem_free_mb": total_free,
    },
    "gpus": [{"index": g["index"], "name": g["name"], "util_pct": g["util_pct"]} for g in gpus],
    "users": [
        {
            "user":        user,
            "processes":   user_procs[user],
            "mem_used_mb": sum(gpu_map.values()),
            "gpu_indices": sorted(gpu_map.keys()),
        }
        for user, gpu_map in sorted(user_gpu_mem.items(), key=lambda x: -sum(x[1].values()))
    ],
    "idle_allocated_gpus": [
        {"gpu": idx, "user": user} for idx, user in idle_allocated
    ],
}

print(json.dumps(report, indent=2))
