"""One async Skipjack collector, with durable backfill and isolated DB work."""
from __future__ import annotations


import asyncio
import logging
import math
import os
from pathlib import Path
import time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .async_utils import run_in_thread

from .commands import ASSOC_ARGS, PARTITION_ARGS, SHARE_FIELDS, CommandResult, nodes_args, queue_args, sacct_args
from .config import ClusterConfig
from .transport import SlurmTransport
from .parse import account_load, parse_associations, parse_jobs, parse_nodes, parse_partitions, parse_qos, parse_queue, parse_shares, pool_capacity
from .reconstruct import fill_gaps
from .store import ClusterDbLocked, ClusterStore

log = logging.getLogger(__name__)


def server_timezone() -> str:
    zone = os.environ.get("TZ", "")
    if not zone:
        path = str(Path("/etc/localtime").resolve())
        zone = path.split("/zoneinfo/")[-1] if "/zoneinfo/" in path else "UTC"
    try:
        ZoneInfo(zone)
    except (ZoneInfoNotFoundError, ValueError):
        return "UTC"
    return zone


class ClusterUnavailable(RuntimeError):
    pass


class RefreshThrottled(RuntimeError):
    pass


class ClusterMonitor:
    def __init__(self, config: ClusterConfig, *, runner=None, clock=time.time):
        self.config = config
        self.runner = runner
        self.clock = clock
        self.transport = SlurmTransport(config) if runner is None else None
        self._transport_ready = runner is not None or self.transport.mode == "local"
        self.timezone = server_timezone()
        self.store: ClusterStore | None = None
        self.partition_meta = {}
        self.partitions = list(config.partitions)
        self.available = False
        self.locked = False
        self.error = None
        self.last_tick = None
        self.last_sacct = None
        self.last_metadata = None
        self.last_refresh = None
        self.failures = 0
        self.speed_cache = {}
        self._loop_task = None
        self._tick_task = None
        self._backfill_task = None
        self._stopping = False

    async def start(self):
        if not self.config.enabled:
            return
        missing = self.transport.missing if self.transport and self.transport.mode == "local" else []
        if missing:
            self.error = f"Slurm commands unavailable: {', '.join(missing)}"
            return
        try:
            await run_in_thread(self._open_store)
        except Exception as e:
            self.locked = isinstance(e, ClusterDbLocked)
            self.error = str(e)
            log.warning("Cluster monitor could not open its database: %s", e)
            return
        self.partition_meta = {p["name"]: p for p in await run_in_thread(self.store.records, "partitions")}
        if not self.partitions:
            self.partitions = sorted(p["name"] for p in self.partition_meta.values() if p["gpus"] > 0)
        self.available = self._transport_ready
        # Startup doesn't wait for Slurm or a history scan; the rest of the observatory can serve immediately.
        self._loop_task = asyncio.create_task(self._loop(), name="cluster-collector")

    def _open_store(self):
        # Retain ownership even if startup is cancelled while its worker finishes opening.
        self.store = ClusterStore(self.config.db_path)

    async def stop(self):
        self._stopping = True
        tasks = [t for t in (self._loop_task, self._tick_task, self._backfill_task) if t is not None]
        for task in tasks:
            task.cancel()
        try:
            await asyncio.gather(*tasks, return_exceptions=True)
        finally:
            if self.store:
                await run_in_thread(self.store.close)
            self.store = None
            self.available = False

    def status(self) -> dict:
        store = self.store
        synced = store.meta("sacct_synced_to") if store else None
        return dict(enabled=self.config.enabled, available=self.available, locked=self.locked, error=self.error,
                    last_tick_ms=self.last_tick, last_sacct_ms=self.last_sacct,
                    sacct_synced_to_ms=synced * 1000 if synced is not None else None,
                    backfill=dict(done_days=min(self.config.backfill_days, store.meta("backfill_done_days", 0) if store else 0),
                                  total_days=self.config.backfill_days),
                    job_rows=store.all("SELECT count(*) n FROM jobs")[0]["n"] if store else 0,
                    db_bytes=store.db_bytes() if store else 0, accounts=len(store.records("accounts")) if store else 0)

    async def _read(self, command: str, args: list[str]) -> CommandResult:
        if self.runner:
            return await self.runner(command, args)
        return await self.transport(command, args)

    @staticmethod
    def _failure(command: str, result: CommandResult) -> str:
        detail = result.stderr.strip().splitlines()
        return f"{command}: {detail[-1][:200] if detail else 'read failed'}"

    async def _loop(self):
        while not self._stopping:
            if not self._transport_ready:
                try:
                    zone = await self.transport.preflight()
                    try:
                        ZoneInfo(zone)
                        self.timezone = zone
                    except (ZoneInfoNotFoundError, ValueError):
                        self.timezone = "UTC"
                    self._transport_ready = True
                    self.available = True
                    self.error = None
                except Exception as exc:
                    self.available = False
                    self.error = str(exc)
                    await asyncio.sleep(self.config.poll_seconds)
                    continue
            await self.tick()
            if self.partitions and (self._backfill_task is None or self._backfill_task.done()):
                self._backfill_task = asyncio.create_task(self._backfill(), name="cluster-backfill")
            await asyncio.sleep(self.config.poll_seconds * min(4, 2**min(self.failures, 2)))

    async def tick(self):
        if not self.store or self._stopping:
            return
        if self._tick_task is None or self._tick_task.done():
            self._tick_task = asyncio.create_task(self._tick(), name="cluster-tick")
        # Browser disconnection does not cancel the shared collector.
        await asyncio.shield(self._tick_task)

    async def refresh(self):
        if not self.available or self._stopping:
            raise ClusterUnavailable(self.error or "The cluster monitor is disabled")
        if self._tick_task is not None and not self._tick_task.done():
            await asyncio.shield(self._tick_task)
            return
        now = self.clock()
        if self.last_refresh is not None and now - self.last_refresh < 60:
            raise RefreshThrottled("Cluster refresh is limited to once a minute")
        self.last_refresh = now
        await self.tick()

    async def _metadata(self, now: int) -> list[str]:
        assoc, partitions = await asyncio.gather(self._read("sacctmgr", ASSOC_ARGS), self._read("scontrol", PARTITION_ARGS))
        errors = []
        if partitions.code == 0:
            self.partition_meta = parse_partitions(partitions.stdout)
            await run_in_thread(self.store.replace_metadata, "partitions", list(self.partition_meta.values()), "name")
            self.partitions = list(self.config.partitions) or sorted(p["name"] for p in self.partition_meta.values() if p["gpus"] > 0)
        else:
            errors.append(self._failure("scontrol", partitions))
        if assoc.code != 0:
            return errors + [self._failure("sacctmgr associations", assoc)]
        rows = parse_associations(assoc.stdout)
        names = sorted({r["account"] for r in rows if r["user"] and any(
            r["account"] == prefix or r["account"].startswith(prefix + "_") for prefix, _ in self.config.groups)})
        qos_names = sorted({r["qos"] for r in rows if r["account"] in names and r["user"] is None and r["qos"]})
        qos = await self._read("sacctmgr", ["-nP", "show", "qos", ",".join(qos_names), "format=Name,GrpTRES,MaxTRESPA,MaxTRESPU,MaxJobsPA,MaxSubmitPA"]) if qos_names else CommandResult(0)
        if qos.code != 0:
            return errors + [self._failure("sacctmgr QoS", qos)]
        limits = parse_qos(qos.stdout)
        accounts = []
        for account in names:
            entity = next((r for r in rows if r["account"] == account and r["user"] is None), {})
            members = [r for r in rows if r["account"] == account and r["user"] is not None]
            group = next(label for prefix, label in self.config.groups if account == prefix or account.startswith(prefix + "_"))
            accounts.append(dict(account=account, group=group, qos=entity.get("qos", ""), members={r["user"]: dict(gpu_cap=r.get("grp_gpu")) for r in members}, users=len(members),
                                 caps=dict(acct_gpu=entity.get("grp_gpu"), **limits.get(entity.get("qos"), {}))))
        await run_in_thread(self.store.replace_metadata, "accounts", accounts, "account")
        if not errors:
            self.last_metadata = now
        return errors

    async def _tick(self):
        now = int(self.clock())
        errors = []
        try:
            if self.last_metadata is None or now - self.last_metadata >= self.config.metadata_seconds:
                errors.extend(await self._metadata(now))
            if not self.partitions:
                self.error = "; ".join(errors) or "No GPU partitions visible to this Slurm user"
                self.failures += 1
                return
            accounts = await run_in_thread(self.store.records, "accounts")
            names = [a["account"] for a in accounts]
            q, n, sh = await asyncio.gather(
                self._read("squeue", queue_args(self.partitions)), self._read("sinfo", nodes_args(self.partitions)),
                self._read("sshare", ["-nP", "-a", "-A", ",".join(names), "-o", SHARE_FIELDS]) if names else asyncio.sleep(0, result=CommandResult(0)))
            queue = parse_queue(q.stdout) if q.code == 0 else await run_in_thread(self.store.records, "queue")
            if q.code == 0:
                await run_in_thread(self.store.replace_queue, queue, now)
            else:
                errors.append(self._failure("squeue", q))
            pools, shapes = pool_capacity(parse_nodes(n.stdout), self.partition_meta, queue) if n.code == 0 else ([], {})
            if n.code != 0:
                errors.append(self._failure("sinfo", n))
            if shapes:
                await run_in_thread(self.store.set_meta, "node_shapes", shapes)
            loads = list(account_load(queue, names).values()) if q.code == 0 else []
            await run_in_thread(self.store.add_samples, now, loads, pools)
            if sh.code == 0 and names:
                await run_in_thread(self.store.add_shares, now, parse_shares(sh.stdout))
            elif sh.code != 0:
                errors.append(self._failure("sshare", sh))
            if self.last_sacct is None or now * 1000 - self.last_sacct >= self.config.history_seconds * 1000:
                failure = await self._sync_history(now)
                if failure:
                    errors.append(failure)
                else:
                    self.last_sacct = now * 1000
                    await run_in_thread(fill_gaps, self.store, self.partition_meta, self.config, now)
            last_deep = await run_in_thread(self.store.meta, "last_deep", now)
            if now - last_deep >= 86400:
                for day in range(2):
                    failure = await self._history_window(now - (day + 1) * 86400 - 600, now - day * 86400)
                    if failure:
                        errors.append(failure)
                        break
                else:
                    await run_in_thread(self.store.retention, now, self.config.jobs_days, self.config.samples_days)
                    await run_in_thread(self.store.set_meta, "last_deep", now)
            elif await run_in_thread(self.store.meta, "last_deep") is None:
                await run_in_thread(self.store.set_meta, "last_deep", now)
            self.last_tick = now * 1000
            self.failures = self.failures + 1 if q.code else 0
            self.error = "; ".join(errors) if errors else None
        except Exception as e:
            self.failures += 1
            self.error = str(e)
            log.exception("Cluster collection failed")

    async def _history_window(self, start: int, end: int, marker=None):
        now = self.clock()
        result = await self._read("sacct", sacct_args(self.partitions, max(1, math.ceil((now - start) / 60)), max(0, math.floor((now - end) / 60))))
        if result.code != 0:
            return self._failure("sacct", result)
        await run_in_thread(self.store.upsert_jobs, parse_jobs(result.stdout), int(now), marker)
        return None

    async def _sync_history(self, now: int):
        synced = await run_in_thread(self.store.meta, "sacct_synced_to", now)
        start = min(synced, now) - 900
        while start < now:
            end = min(now, start + 86400)
            failure = await self._history_window(start, end, ("sacct_synced_to", end))
            if failure:
                return failure
            start = end
        # Refresh orphaned open records by id; vanished rows cannot pend forever in statistics.
        ids = [str(j["job_id"]) for j in await run_in_thread(self.store.all,
            "SELECT DISTINCT job_id FROM jobs WHERE end_ts IS NULL AND last_seen<? LIMIT 200", now)]
        if ids:
            from .commands import SACCT_FIELDS
            from .parse import SEP
            result = await self._read("sacct", ["-a", "-X", "-D", "-n", "-P", f"--delimiter={SEP}", "-j", ",".join(ids), "-o", SACCT_FIELDS])
            if result.code == 0:
                jobs = parse_jobs(result.stdout)
                await run_in_thread(self.store.upsert_jobs, jobs, now)
                found = {j["job_id"] for j in jobs}
                await run_in_thread(self._mark_lost, [int(i) for i in ids if int(i) not in found], now)
        return None

    def _mark_lost(self, ids, now):
        with self.store.lock, self.store.db:
            self.store.db.executemany("UPDATE jobs SET state='LOST',end_ts=last_seen WHERE job_id=? AND end_ts IS NULL", [(i,) for i in ids])

    async def _backfill(self):
        try:
            store = self.store
            anchor = await run_in_thread(store.meta, "backfill_anchor")
            if anchor is None:
                anchor = int(self.clock())
                await run_in_thread(store.set_meta, "backfill_anchor", anchor)
            while not self._stopping:
                done = await run_in_thread(store.meta, "backfill_done_days", 0)
                if done >= self.config.backfill_days:
                    return
                failure = await self._history_window(anchor - (done + 1) * 86400 - 600, anchor - done * 86400,
                                                     ("backfill_done_days", done + 1))
                if failure:
                    self.error = failure
                    return
                await asyncio.sleep(self.config.backfill_pause)
                if done + 1 >= self.config.backfill_days:
                    await run_in_thread(fill_gaps, store, self.partition_meta, self.config, int(self.clock()))
        except Exception as e:
            self.error = str(e)
            log.exception("Cluster backfill failed")
