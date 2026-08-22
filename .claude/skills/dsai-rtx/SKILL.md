---
name: dsai-rtx
description: How to log in to and use the RTX dev node on DSAI (devdanielk, 8x RTX PRO 6000 Blackwell). Use when the user asks about the RTX node, devdanielk, the Blackwell dev box, or running jobs directly (no SLURM) on DSAI's RTX machine.
---

# DSAI — RTX node (`devdanielk`)

`devdanielk` is our **dedicated RTX dev node** on DSAI. Unlike the general DSAI
partitions, it is **not under SLURM** — no scheduler, no partitions, no queue.
Users SSH in directly and run jobs on the box.

## Login

```bash
ssh devdanielk
```

Resolves to:

| | |
|---|---|
| HostName | `devdanielk` |
| User | `dkhasha1` |
| ProxyJump | `dsai` |

It sits behind the DSAI login node, so SSH **jumps through `dsai`** automatically
(you need working `dsai` access first — see [[dsai-general]]).

## Hardware / resources

- **8× NVIDIA RTX PRO 6000 Blackwell** GPUs.
- Direct, interactive use — no `srun`/`sbatch`. Just SSH in and run.
- Because there's no scheduler, **coordinate with teammates** to avoid stepping on
  each other's GPUs (check `nvidia-smi` before grabbing devices).

## Common commands (after `ssh devdanielk`)

```bash
nvidia-smi                          # per-GPU util, memory, power
CUDA_VISIBLE_DEVICES=0,1 python train.py   # pin to specific GPUs
```

## Getting stats without logging in

```bash
python3 danielgpus_devdanielk.py
```

Auto-SSHes (through the `dsai` proxy jump) and reports per-GPU util/memory/power,
per-user GPU-memory usage, and idle-but-allocated GPUs, as a table + JSON. There
is no pending-jobs section — there's no scheduler.

## Related

- [[dsai-general]] — the SLURM partitions on DSAI (needed as the proxy jump).
- [[dsai-h200]], [[ia1]], [[skipjack]].
