#!/usr/bin/env python3
"""Minimal GPU memory collector for DSAI jobs — run from IA1, auto-SSHes to dsai."""

import os
import re
import subprocess
import sys

REMOTE = "dsai"

if os.environ.get("_ON_REMOTE") != "1":
    sys.exit(subprocess.run(
        ["ssh", REMOTE, "env", "_ON_REMOTE=1", "python3", "-"],
        stdin=open(__file__)
    ).returncode)

# --- runs on dsai from here ---


def run(cmd):
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          universal_newlines=True).stdout


# Get dkhasha1 running jobs with GPU allocations
squeue_out = run([
    "squeue", "--account=dkhasha1", "-t", "R",
    "-O", "JobID:12,UserName:20,Partition:10,tres-alloc:100",
    "--noheader",
])

jobs = []
for line in squeue_out.splitlines():
    fields = line.split()
    if len(fields) < 3:
        continue
    jobid = fields[0].strip()
    user  = fields[1].strip()
    part  = fields[2].strip().rstrip("*")
    tres  = fields[3].strip() if len(fields) > 3 else ""
    m = re.search(r"gres/gpu[^=,\s]*=(\d+)", tres)
    gpus = int(m.group(1)) if m else 0
    if gpus > 0:
        jobs.append((jobid, user, part, gpus))

if not jobs:
    print("No dkhasha1 GPU jobs running.")
    sys.exit(0)

print(f"{'JOBID':<12} {'USER':<15} {'PART':<8} {'GPUS':>4}  {'MEM USED':>10}  {'MEM TOTAL':>10}  {'MEM %':>6}")
print("-" * 72)

for jobid, user, part, gpus in jobs:
    srun_out = subprocess.run(
        [
            "srun", "--overlap",
            f"--jobid={jobid}",
            "--ntasks-per-node=1",
            "nvidia-smi",
            "--query-gpu=memory.used,memory.total",
            "--format=csv,noheader,nounits",
        ],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        universal_newlines=True, timeout=20,
    ).stdout

    used = total = 0
    for line in srun_out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 2:
            continue
        try:
            used  += int(parts[0])
            total += int(parts[1])
        except ValueError:
            pass

    if total > 0:
        pct = f"{used / total * 100:.0f}%"
        mem_used  = f"{used / 1024:.1f} GB"
        mem_total = f"{total / 1024:.0f} GB"
    else:
        pct = mem_used = mem_total = "n/a"

    print(f"{jobid:<12} {user:<15} {part:<8} {gpus:>4}  {mem_used:>10}  {mem_total:>10}  {pct:>6}")
