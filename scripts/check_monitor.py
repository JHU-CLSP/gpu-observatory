"""Run one bounded read-only collection against Slurm, using a temporary DB."""
import argparse
import asyncio
from dataclasses import replace
import json
from pathlib import Path
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from monitor.collector import ClusterMonitor
from monitor.config import ClusterConfig
from monitor.async_utils import run_in_thread
from monitor.models import ClusterOverview
from monitor.views import overview


async def main(args):
    with tempfile.TemporaryDirectory(prefix="observatory-check-") as directory:
        config = replace(ClusterConfig.from_env(), enabled=True, transport=args.transport,
                         db_path=Path(directory) / "monitor.sqlite3", backfill_days=args.history_days)
        monitor = ClusterMonitor(config)
        try:
            if monitor.transport.mode == "ssh":
                monitor.timezone = await monitor.transport.preflight()
            elif monitor.transport.missing:
                raise RuntimeError("Missing Slurm tools: " + ", ".join(monitor.transport.missing))
            await run_in_thread(monitor._open_store)
            monitor.available = True
            await monitor.tick()
            if monitor.error:
                raise RuntimeError(monitor.error)
            if args.history_days:
                await monitor._backfill()
                if monitor.error:
                    raise RuntimeError(monitor.error)
            result = ClusterOverview.model_validate(await run_in_thread(overview, monitor, int(time.time() * 1000)))
            raw = monitor.store.records("queue")
            raw_running = sum(job["gpus"] for job in raw if job["state"] in {"R", "CG", "S"}
                              and any(job["account"] == p or job["account"].startswith(p + "_") for p, _ in config.groups))
            view_running = sum(group.run_gpus for group in result.groups)
            if raw_running != view_running:
                raise RuntimeError(f"Queue/view count mismatch: {raw_running} != {view_running}")
            print(json.dumps(dict(transport=monitor.transport.mode, accounts=result.status.accounts,
                                  pools=len(result.capacity), job_records=result.status.job_rows,
                                  tracked_running_gpus=view_running, raw_queue_matches=True,
                                  backfill_days=result.status.backfill.done_days, error=result.status.error), indent=2))
        finally:
            await monitor.stop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", required=True, help="explicitly allow read-only cluster queries")
    parser.add_argument("--transport", choices=("auto", "local", "ssh"), default="auto")
    parser.add_argument("--history-days", type=int, choices=(0, 1), default=0)
    args = parser.parse_args()
    asyncio.run(asyncio.wait_for(main(args), 240))
