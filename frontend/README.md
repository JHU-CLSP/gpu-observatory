# IA Lab GPU Observatory

Real-time GPU monitoring dashboard for the IA Lab's three compute resources: DSAI cluster, Rockfish cluster, and IA1 node.

## Architecture

```
gpu-stats-ia1-lab/
  app.py                    # FastAPI backend — runs collector scripts, caches results, serves frontend
  danielgpus_dsai.py        # DSAI SLURM collector (SSH → dsai)
  danielgpus_rockfish.py    # Rockfish SLURM collector (SSH → rockfish)
  danielgpus_ia1.py         # IA1 nvidia-smi collector (SSH → ia1)
  run.sh                    # Single-command launcher (builds frontend + starts server)
  frontend/                 # React/TypeScript frontend (Vite)
```

The backend polls each server every 15 minutes and caches results in memory. The frontend auto-refreshes every 30 seconds.

## Running

### Production (single command)

```bash
sudo ./run.sh
```

This builds the frontend and starts the server on port 443. `sudo` is required to bind port 443.

The dashboard is then available at `http://<host>`.

### Development

```bash
# Terminal 1 — backend
uvicorn app:app --reload --port 8000

# Terminal 2 — frontend dev server
cd frontend && npm run dev
```

The dev frontend expects the backend at `localhost:8000`. Change `API_BASE` in `frontend/src/app/App.tsx` if needed.

## Prerequisites

| Component | Minimum version | Notes |
|-----------|----------------|-------|
| Python    | 3.9            | 3.10+ recommended; 3.9 works via `from __future__ import annotations` |
| Node.js   | 18             | Required by Vite 6; only needed to build the frontend |
| npm       | 8              | Bundled with Node 18; not needed on server if `frontend/dist/` is pre-built |

Python packages (install with `pip install -e .`):

| Package   | Version |
|-----------|---------|
| fastapi   | ≥ 0.110 |
| uvicorn   | ≥ 0.29  |
| aiofiles  | ≥ 23.0  |

SSH aliases `dsai`, `rockfish`, `ia1` must be configured in `~/.ssh/config` on the machine running the server.

## Features

- **DSAI & Rockfish**: partition GPU totals, team usage, idle-allocated GPU detection (via SSH + nvidia-smi to compute nodes), interactive job warnings, scratch space
- **IA1**: per-GPU utilization grid, per-user breakdown with idle GPU annotation, scratch space
- **Historical charts**: 24-hour GPU usage trends (sampled every 15 min or on manual refresh)
