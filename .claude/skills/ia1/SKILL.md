---
name: ia1
description: How to log in to and use the IA1 lab server (the single-node 10x A6000 box that also hosts this GPU-stats dashboard). Use when the user asks about connecting to IA1, running jobs on it, its GPUs, scratch space, or the SLURM queue there.
---

# IA1

IA1 is our lab's **single-node GPU server** and the host that runs this GPU-stats
dashboard web app. It is exclusively ours — no shared cluster scheduling politics.

## Login

```bash
ssh ia1
```

Resolves (via `~/.ssh/config`) to:

| | |
|---|---|
| HostName | `ia1.wse.jhu.edu` |
| User | `dkhasha1` |

Reachable from any machine (no proxy/jump host). This is where the dashboard web
app is meant to run.

## Hardware / resources

- **10× NVIDIA RTX A6000** (48 GB each) in one node.
- Local **`/scratch`** space (check free space with `df -h /scratch`).
- Runs **SLURM**, but since it's our exclusive node the queue is just our own jobs.

## Common commands (run after `ssh ia1`)

```bash
nvidia-smi                       # live per-GPU util / memory
squeue                           # all jobs (everything here is ours)
squeue -t PD                     # pending jobs
srun --gres=gpu:1 --pty bash     # grab 1 GPU interactively
df -h /scratch                   # scratch usage
```

## Getting live stats without logging in

From a machine with `ia1` SSH access, the collector auto-SSHes for you:

```bash
python3 danielgpus_ia1.py
```

It prints a per-GPU table, per-user GPU-memory usage, idle-but-allocated GPUs,
pending jobs, and `/scratch` usage, then a JSON report.

## Related

- [[dsai-general]], [[dsai-rtx]], [[dsai-h200]] — the DSAI cluster resources.
- [[skipjack]] — the ARCH production cluster.
