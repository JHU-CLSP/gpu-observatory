#!/usr/bin/env python3
"""GPU memory collector for DSAI — run from IA1.

Uses ssh to the DSAI login node only for squeue/scontrol (no srun).
Then SSHes directly from IA1 to each compute node for nvidia-smi.
"""

import re
import subprocess

DSAI_LOGIN = "dsai"
SSH_OPTS = ["-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-o", "BatchMode=yes"]


def ssh(host, cmd):
    result = subprocess.run(
        ["ssh"] + SSH_OPTS + [host, cmd],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True,
    )
    return result.stdout


# ── Step 1: get running dkhasha1 jobs + node lists from DSAI login node ──────

squeue_out = ssh(DSAI_LOGIN,
    "squeue --account=dkhasha1 -t R "
    "-O 'JobID:12,UserName:20,Partition:10,NodeList:60,tres-alloc:100' --noheader"
)

jobs = []  # (jobid, user, part, gpus, [nodes])
for line in squeue_out.splitlines():
    fields = line.split()
    if len(fields) < 4:
        continue
    jobid    = fields[0].strip()
    user     = fields[1].strip()
    part     = fields[2].strip().rstrip("*")
    nodelist = fields[3].strip()
    tres     = fields[4].strip() if len(fields) > 4 else ""

    m = re.search(r"gres/gpu[^=,\s]*=(\d+)", tres)
    gpus = int(m.group(1)) if m else 0
    if gpus == 0:
        continue

    # Expand compact node list e.g. "gpu[01-03]" → "gpu01 gpu02 gpu03"
    expanded = ssh(DSAI_LOGIN, f"scontrol show hostnames {nodelist}")
    nodes = [n for n in expanded.split() if n]
    jobs.append((jobid, user, part, gpus, nodes))

if not jobs:
    print("No dkhasha1 GPU jobs running.")
    raise SystemExit(0)

# ── Step 2: SSH from IA1 directly to each compute node for nvidia-smi ────────

print(f"{'JOBID':<12} {'USER':<15} {'PART':<8} {'GPUS':>4}  {'MEM USED':>10}  {'MEM TOTAL':>10}  {'MEM %':>6}  NODES")
print("-" * 90)

for jobid, user, part, gpus, nodes in jobs:
    used = total = 0
    for node in nodes:
        out = ssh(node,
            "nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits"
        )
        for line in out.strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 2:
                continue
            try:
                used  += int(parts[0])
                total += int(parts[1])
            except ValueError:
                pass

    if total > 0:
        pct       = f"{used / total * 100:.0f}%"
        mem_used  = f"{used  / 1024:.1f} GB"
        mem_total = f"{total / 1024:.0f} GB"
    else:
        pct = mem_used = mem_total = "n/a"

    node_str = ",".join(nodes)
    print(f"{jobid:<12} {user:<15} {part:<8} {gpus:>4}  {mem_used:>10}  {mem_total:>10}  {pct:>6}  {node_str}")
