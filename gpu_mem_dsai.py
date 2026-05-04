#!/usr/bin/env python3
"""GPU memory collector for DSAI compute nodes — run from IA1.

Usage:
    python3 gpu_mem_dsai.py NODE [NODE ...]

Example:
    python3 gpu_mem_dsai.py gpu-a100-01 gpu-h100-03
"""

import subprocess
import sys

SSH_OPTS = ["-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-o", "BatchMode=yes"]

if len(sys.argv) < 2:
    print("Usage: python3 gpu_mem_dsai.py NODE [NODE ...]")
    sys.exit(1)

nodes = sys.argv[1:]

print(f"{'NODE':<25} {'GPU':>4}  {'MEM USED':>10}  {'MEM TOTAL':>10}  {'MEM %':>6}  {'UTIL':>6}")
print("-" * 72)

for node in nodes:
    out = subprocess.run(
        ["ssh"] + SSH_OPTS + [node,
            "nvidia-smi --query-gpu=index,utilization.gpu,memory.used,memory.total "
            "--format=csv,noheader,nounits"
        ],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True,
    ).stdout

    if not out.strip():
        print(f"{node:<25}  (unreachable or no nvidia-smi)")
        continue

    for line in out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 4:
            continue
        try:
            idx   = parts[0]
            util  = parts[1]
            used  = int(parts[2])
            total = int(parts[3])
        except ValueError:
            continue
        pct       = f"{used / total * 100:.0f}%" if total else "n/a"
        mem_used  = f"{used  / 1024:.1f} GB"
        mem_total = f"{total / 1024:.0f} GB"
        print(f"{node+' GPU'+idx:<25} {idx:>4}  {mem_used:>10}  {mem_total:>10}  {pct:>6}  {util:>5}%")
