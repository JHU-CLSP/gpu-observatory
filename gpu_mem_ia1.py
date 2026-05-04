#!/usr/bin/env python3
"""Minimal GPU memory collector for IA1 — run locally, auto-SSHes to ia1."""

import shutil
import subprocess
import sys

REMOTE = "ia1"

if not shutil.which("nvidia-smi"):
    sys.exit(subprocess.run(["ssh", REMOTE, "python3", "-"], stdin=open(__file__)).returncode)

# --- runs on ia1 from here ---


def run(cmd):
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          universal_newlines=True).stdout


# Per-GPU: index, util%, mem_used, mem_total
for line in run(["nvidia-smi",
                 "--query-gpu=index,utilization.gpu,memory.used,memory.total",
                 "--format=csv,noheader,nounits"]).strip().splitlines():
    idx, util, used, total = [p.strip() for p in line.split(",")]
    pct = round(int(used) / int(total) * 100)
    print(f"GPU {idx}  util={util}%  mem={used}/{total} MiB ({pct}%)")

# Per-process: pid, gpu_uuid, mem_used
print()
for line in run(["nvidia-smi",
                 "--query-compute-apps=pid,gpu_uuid,used_memory",
                 "--format=csv,noheader,nounits"]).strip().splitlines():
    pid, uuid, used = [p.strip() for p in line.split(",")]
    user = run(["ps", "-o", "user=", "-p", pid]).strip() or "?"
    print(f"  pid={pid} user={user} uuid={uuid[:12]}... mem={used} MiB")
