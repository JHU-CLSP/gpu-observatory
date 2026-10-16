"""Cached, rate-limited scheduler estimates from sbatch --test-only."""
from __future__ import annotations

import asyncio
from datetime import datetime
import json
import re
from zoneinfo import ZoneInfo

from .async_utils import run_in_thread
from .commands import PROBE_TIME_LIMITS

CACHE_SECONDS = 900
MIN_BATCH_SECONDS = 60
TIME_LIMIT_BATCHES = (PROBE_TIME_LIMITS[::2], PROBE_TIME_LIMITS[1::2])
CACHE_KEY = "start_estimates_v1"


class ProbeUnavailable(RuntimeError):
    pass


class ProbeThrottled(RuntimeError):
    pass


def parse_estimate(result, checked_ms, timezone):
    output = (result.stdout + "\n" + result.stderr).strip()
    match = re.search(r"\bto start at\s+(\d{4}-\d{2}-\d{2}T[\d:]+(?:[+-][\d:]+|Z)?|\d{10,})", output)
    start = None
    if result.code == 0 and match:
        try:
            value = match[1]
            if value.isdigit():
                start = int(value) * 1000
            else:
                date = datetime.fromisoformat(value.replace("Z", "+00:00"))
                start = int((date if date.tzinfo else date.replace(tzinfo=ZoneInfo(timezone))).timestamp() * 1000)
        except (ValueError, OverflowError):
            pass
    return dict(checked_at_ms=checked_ms, estimated_start_ms=start,
                wait_sec=max(0, (start - checked_ms) / 1000) if start is not None else None,
                status="estimated" if start is not None else "error" if result.code else "unavailable",
                output=output[:4000], exit_code=result.code)


class StartProbes:
    def __init__(self, monitor):
        self.monitor = monitor
        self.task = None
        self.task_key = None
        self.stopping = False
        self.pause_seconds = 1
        self.gate = asyncio.Lock()

    def snapshot(self, account=None, partition=None, cpus_per_gpu=8, memory_gib_per_gpu=64):
        mon = self.monitor
        transport = mon.transport
        user = transport.username if transport else None
        store = mon.store
        accounts = sorted(
            a["account"] for a in store.records("accounts")
            if user in a.get("members", {}) and any(
                a["account"].startswith(prefix + "_") and len(a["account"]) > len(prefix) + 1
                for prefix, _ in mon.config.groups
            )
        ) if store else []
        partitions = list(mon.partitions)
        if account is not None and account not in accounts:
            raise ValueError("Choose a tracked subaccount belonging to the server's Slurm user")
        if partition is not None and partition not in partitions:
            raise ValueError("Choose a monitored GPU partition")
        account = account or next(iter(accounts), None)
        partition = partition or next(iter(partitions), None)
        available = bool(mon.available and store and transport and transport.can_probe and user and account and partition and not self.stopping)
        error = None if available else mon.error or "Test mode requires sbatch and a tracked subaccount for the server's Slurm user"
        target = mon.config.ssh_host if transport and getattr(transport, "mode", "local") == "ssh" else "local"
        key = json.dumps([target, user, account, partition, cpus_per_gpu, memory_gib_per_gpu])
        cached = (store.meta(CACHE_KEY, {}) if store else {}).get(key, {})
        return dict(available=available, error=error, probe_user=user, accounts=accounts, partitions=partitions,
                    account=account, partition=partition, cpus_per_gpu=cpus_per_gpu, memory_gib_per_gpu=memory_gib_per_gpu,
                    cache_seconds=CACHE_SECONDS, checked_at_ms=cached.get("checked_at_ms"),
                    time_limits_minutes=list(PROBE_TIME_LIMITS),
                    next_time_limits_minutes=list(TIME_LIMIT_BATCHES[cached.get("next_batch", 0)]),
                    rows=cached.get("rows", []), probing=bool(self.task and not self.task.done() and self.task_key == key)), key

    async def refresh(self, account=None, partition=None, cpus_per_gpu=8, memory_gib_per_gpu=64):
        args = (account, partition, cpus_per_gpu, memory_gib_per_gpu)
        async with self.gate:
            view, key = await run_in_thread(self.snapshot, *args)
            if not view["available"]:
                raise ProbeUnavailable(view["error"])
            now = int(self.monitor.clock() * 1000)
            if view["checked_at_ms"] is not None and 0 <= now - view["checked_at_ms"] < CACHE_SECONDS * 1000:
                return view
            if self.task is not None and not self.task.done():
                if self.task_key != key:
                    raise ProbeThrottled("Another start-time probe is running; retry in a minute")
            else:
                last = await run_in_thread(self.monitor.store.meta, "last_start_probe_ms")
                if last is not None and now - last < MIN_BATCH_SECONDS * 1000:
                    raise ProbeThrottled("Start-time probes allow one new batch per minute")
                await run_in_thread(self.monitor.store.set_meta, "last_start_probe_ms", now)
                self.task_key = key
                self.task = asyncio.create_task(self._collect(view, key), name="start-time-probes")
            task = self.task
        await asyncio.shield(task)
        return (await run_in_thread(self.snapshot, *args))[0]

    async def _collect(self, view, key):
        rows = []
        profiles = ((gpus, minutes) for gpus in (1, 4, 8) for minutes in view["next_time_limits_minutes"])
        for index, (gpus, minutes) in enumerate(profiles):
            if index:
                await asyncio.sleep(self.pause_seconds)
            checked = int(self.monitor.clock() * 1000)
            cpus = view["cpus_per_gpu"] * gpus
            memory = view["memory_gib_per_gpu"] * gpus
            result = await self.monitor.transport.test_start(view["account"], view["partition"], gpus, minutes, cpus, memory)
            rows.append(dict(gpus=gpus, time_limit_minutes=minutes, cpus=cpus, memory_gib=memory,
                             **parse_estimate(result, checked, self.monitor.timezone)))
        await run_in_thread(self._save, key, rows)

    def _save(self, key, rows):
        store = self.monitor.store
        with store.lock:
            cached = store.meta(CACHE_KEY, {})
            previous = cached.get(key, {})
            merged = {(row["gpus"], row["time_limit_minutes"]): row for row in previous.get("rows", [])}
            merged.update({(row["gpus"], row["time_limit_minutes"]): row for row in rows})
            cached[key] = dict(checked_at_ms=int(self.monitor.clock() * 1000),
                               rows=[merged[profile] for profile in sorted(merged)],
                               next_batch=(previous.get("next_batch", 0) + 1) % len(TIME_LIMIT_BATCHES))
            # Keep a bounded cache shared by all browsers and across restarts.
            cached = dict(sorted(cached.items(), key=lambda entry: entry[1]["checked_at_ms"], reverse=True)[:32])
            store.set_meta(CACHE_KEY, cached)

    async def stop(self):
        self.stopping = True
        async with self.gate:
            if self.task:
                self.task.cancel()
                await asyncio.gather(self.task, return_exceptions=True)
