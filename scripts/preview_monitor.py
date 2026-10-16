"""Offline UI fixture server: uv run uvicorn scripts.preview_monitor:app --port 8017.

Uses synthetic Slurm fixtures and never starts the production collectors.
"""
from contextlib import asynccontextmanager
from dataclasses import replace
from pathlib import Path
import re
import tempfile
import time

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from monitor import routes
from monitor.collector import ClusterMonitor
from monitor.commands import CommandResult
from monitor.config import ClusterConfig
from monitor.async_utils import run_in_thread
from monitor.parse import account_load
from tests.fixtures.cluster import FakeSlurm, NOW


@asynccontextmanager
async def lifespan(app):
    with tempfile.TemporaryDirectory(prefix="observatory-preview-") as directory:
        fake = FakeSlurm()
        now = int(time.time())
        async def runner(command, args):
            result = await fake(command, args)
            # Shift the synthetic fixture dates to today for representative freshness.
            out = re.sub(r"\b1\d{9}\b", lambda m: str(int(m[0]) + now - NOW), result.stdout)
            return CommandResult(result.code, out, result.stderr)
        monitor = ClusterMonitor(replace(ClusterConfig(), db_path=Path(directory) / "preview.db", backfill_days=0), runner=runner)
        routes.monitor = monitor
        await monitor.start()
        await monitor.tick()
        def seed_trends():
            loads = list(account_load(monitor.store.records("queue"), [a["account"] for a in monitor.store.records("accounts")]).values())
            pools = monitor.store.all("SELECT * FROM pool_samples WHERE ts=?", now)
            for step in range(96, 0, -1):
                delta = (step // 8) % 3
                accounts = [dict(a, run_gpus=a["run_gpus"] + delta, pend_gpus_queue=(step // 12) % 4) for a in loads]
                capacity = [dict(p, used=min(p["total"], p["used"] + delta), idle=max(0, p["idle"] - delta)) for p in pools]
                monitor.store.add_samples(now - step * 900, accounts, capacity)
        await run_in_thread(seed_trends)
        try:
            yield
        finally:
            await monitor.stop()


app = FastAPI(lifespan=lifespan)
app.include_router(routes.router)
app.include_router(routes.router, prefix="/port5000")

@app.get("/port5000/stats/history")
@app.get("/stats/history")
async def history():
    return []

@app.get("/port5000/stats/{server}")
@app.get("/stats/{server}")
async def legacy(server: str):
    return {"error": "Offline preview: overview collectors are disabled"}

# Both built base paths work without a reverse proxy for the preview.
dist = Path(__file__).resolve().parents[1] / "frontend" / "dist"
app.mount("/port5000", StaticFiles(directory=dist, html=True), name="prefixed-ui")
app.mount("/", StaticFiles(directory=dist, html=True), name="ui")
