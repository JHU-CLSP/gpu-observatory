---
name: dsai-general
description: How to log in to and use the general SLURM GPU nodes on the DSAI cluster (a100, h100, nvl, l40s partitions). Use when the user asks about connecting to DSAI, submitting jobs, available partitions/GPU types, or our dkhasha1 account there.
---

# DSAI — general nodes

DSAI is a shared **SLURM cluster** at ARCH (JHU). We submit jobs under the
**`dkhasha1`** account. This skill covers the general GPU partitions; the RTX dev
node and the H200 partition have their own skills ([[dsai-rtx]], [[dsai-h200]]).

## Login

```bash
ssh dsai
```

Resolves to:

| | |
|---|---|
| HostName | `dsailogin.arch.jhu.edu` |
| User | `dkhasha1` |

This lands you on a **login node** — do not run compute there; submit jobs to
SLURM. Note: **PAM blocks direct SSH to compute nodes**, so you can't `ssh` into
an allocated node to inspect it; use SLURM tooling instead.

## Partitions / GPU types

| Partition | GPU type |
|---|---|
| `a100` | NVIDIA A100 |
| `h100` | NVIDIA H100 |
| `nvl`  | H100 NVL |
| `l40s` | NVIDIA L40S |

(The `h200` partition is separate and team-capped — see [[dsai-h200]].)

## Common commands

```bash
# Idle GPUs per partition
sinfo -p a100,h100,nvl,l40s -N -o "%N|%P|%G|%t"

# Our account's running jobs
squeue --account=dkhasha1

# Interactive shell with 1 A100
srun -p a100 --account=dkhasha1 --gres=gpu:1 --pty bash

# Batch submit
sbatch -p h100 --account=dkhasha1 --gres=gpu:2 job.sh
```

## Getting stats without logging in

```bash
python3 danielgpus_dsai.py
```

Auto-SSHes to `dsai` and reports idle GPUs per partition, per-user and
`dkhasha1`-account GPU usage, interactive jobs, and pending jobs, as a table +
JSON. (Idle-allocated GPU detection is unavailable because PAM blocks SSH to
compute nodes.)

## Related

- [[dsai-rtx]] — the `devdanielk` 8× RTX PRO 6000 dev node (reached via DSAI).
- [[dsai-h200]] — the H200 partition (24-GPU team cap).
- [[ia1]], [[skipjack]].
