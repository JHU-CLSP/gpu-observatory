---
name: dsai-h200
description: How to use the H200 GPU partition on the DSAI cluster (team-capped at 24 GPUs, 4 GPUs per node). Use when the user asks about H200s on DSAI, the h200 partition, or our team's H200 allocation limit.
---

# DSAI — H200 partition

The `h200` partition is a **separate, team-capped** GPU partition on the DSAI
SLURM cluster. It is not visible in the default `sinfo` output — you must query it
explicitly with `-p h200`.

## Access

Same login and account as the rest of DSAI (see [[dsai-general]]):

```bash
ssh dsai        # HostName dsailogin.arch.jhu.edu, User dkhasha1
```

Submit under the **`dkhasha1`** account, partition **`h200`**.

## Hardware / limits

- **NVIDIA H200** GPUs, **4 GPUs per node**.
- **Team allocation limit: 24 GPUs** (`dkhasha1` account cap across the partition).
- Standard SLURM scheduling; **PAM blocks direct SSH to compute nodes**.

## Common commands

```bash
# Node states for the H200 partition (must pass -p h200 explicitly)
sinfo -p h200 -o "%n %T" --noheader

# All running jobs on h200 (any account)
squeue -p h200 -t R

# Our pending jobs
squeue -p h200 -t PD --account=dkhasha1

# Interactive: grab a full H200 node (4 GPUs)
srun -p h200 --account=dkhasha1 --gres=gpu:h200:4 --pty bash

# Batch
sbatch -p h200 --account=dkhasha1 --gres=gpu:h200:8 job.sh
```

Remember the 24-GPU team cap when sizing requests — going over won't schedule.

## Getting stats without logging in

`python3 danielgpus_dsai.py` includes an H200 section: per-node state, running
jobs (team vs. total GPUs used against the 24 cap), and our pending H200 jobs.

## Related

- [[dsai-general]] — DSAI login and general partitions.
- [[dsai-rtx]], [[ia1]], [[skipjack]].
