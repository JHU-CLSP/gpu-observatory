"""The read-only monitor's data and lifecycle contracts, using fake commands."""

import asyncio
from dataclasses import replace

import pytest

from monitor import commands, parse, views, waits
from monitor.collector import ClusterMonitor, RefreshThrottled
from monitor.config import ClusterConfig
from monitor.models import ClusterOverview, QueueSpeedResponse, SeriesResponse
from monitor.reconstruct import array_tasks, gap_times, reconstruct
from monitor.store import ClusterDbLocked, ClusterStore
from tests.fixtures.cluster import FakeSlurm, NODES, NOW, PARTITIONS, QUEUE, job_line


def make_monitor(tmp_path, fake=None, **config):
    mon = ClusterMonitor(replace(ClusterConfig(), **{"db_path": tmp_path / "cluster.db", "backfill_days": 0, **config}),
                         runner=fake or FakeSlurm(), clock=lambda: NOW)
    mon.store = ClusterStore(mon.config.db_path)
    mon.available = True
    return mon


@pytest.mark.anyio
async def test_default_suite_disables_collector_before_lifespan_start(tmp_path):
    config = replace(ClusterConfig.from_env(), db_path=tmp_path / "must-not-exist.db")
    assert not config.enabled
    mon = ClusterMonitor(config)
    await mon.start()
    try:
        assert not mon.available and mon.store is None
        assert not config.db_path.exists()
    finally:
        await mon.stop()


def test_command_visibility_and_epoch_environment(monkeypatch):
    monkeypatch.setenv("SLURM_JOB_ID", "fake-job")
    monkeypatch.setenv("SBATCH_ACCOUNT", "fake-account")
    monkeypatch.setenv("SLURM_CONF", "/fake/slurm.conf")
    monkeypatch.setenv("RCB_RUN_ID", "fake-run")
    env = commands.command_env()
    assert env["SLURM_TIME_FORMAT"] == "%s"
    assert env["SLURM_CONF"] == "/fake/slurm.conf"
    assert all(k not in env for k in ("SLURM_JOB_ID", "SBATCH_ACCOUNT", "RCB_RUN_ID"))
    assert "-a" in commands.queue_args(["h200_condo"])
    assert "-a" not in commands.nodes_args(["h200_condo"])
    assert "-D" in commands.sacct_args(["h200_condo"], 1440)
    assert commands.PARTITION_ARGS[:2] == ["-a", "-o"]


def test_parsers_preserve_arrays_attempts_epoch_and_unknowns():
    rows = parse.parse_jobs("\n".join([
        job_line(42, label="40_2"), job_line(42, eligible=NOW-3000, wait=None, restarts=1, state="PENDING"),
        job_line(43, label="43_[1-9%2]", wait=None, reservation="reserved"), "garbage",
    ]))
    assert len(rows) == 3
    assert rows[0]["array_id"] == 40 and not rows[0]["array_meta"]
    assert rows[1]["start_ts"] is None and rows[1]["restarts"] == 1
    assert rows[0]["submit_ts"] != rows[1]["submit_ts"]
    assert rows[2]["array_meta"] and rows[2]["reservation"] == "reserved"
    assert parse.timestamp("Unknown") is None
    assert parse.gpu_count("gres/gpu=4,gres/gpu:h100=4") == 4
    assert parse.shape("cpu=8,mem=187.50G,gres/gpu=1")["mem_mb"] == 192000
    assert parse.limit_seconds("2-23:00:00") == 2*86400+23*3600
    assert parse.wait_class("Dependency") == "dependency"
    assert parse.is_limited("MaxGRESPerAccount")
    assert not parse.is_limited("Resources")


def test_shared_pools_count_nodes_and_queue_pressure_once():
    meta = parse.parse_partitions(PARTITIONS)
    pools, shapes = parse.pool_capacity(parse.parse_nodes(NODES), meta, parse.parse_queue(QUEUE))
    h200 = next(p for p in pools if p["pool"] == "h200")
    assert (h200["total"], h200["used"], h200["planned"], h200["pend_gpus_queue"]) == (4, 1, 3, 1)
    assert meta["h200_condo"]["hidden"] and meta["h200_condo"]["tier"] == 10
    assert shapes["a100"]["cpus_per_gpu"] == 11
    assert waits.effective_gpus(1, 64, None, shapes["a100"]) == 6
    for state, expected in [("mix$", "reserved"), ("idle-", "planned"), ("draining", "down"), ("idle*", "down"), ("idle", "idle")]:
        assert parse.node_free_kind(state) == expected


def test_censored_waits_and_array_bursts_do_not_hide_long_waits():
    plain = [dict(t=t, event=True) for t in range(60, 601, 60)]
    assert waits.km_quantiles(plain)["p50_sec"] == 300
    result = waits.km_quantiles(plain + [dict(t=1000, event=False)] * 5)
    assert result["p50_sec"] == 480 and result["p90_sec"] is None and result["at_least_sec"] == 1000
    jobs = parse.parse_jobs("\n".join(job_line(200+i, label=f"200_{i}", wait=60+i*30) for i in range(400)))
    for j in jobs:
        j.update(limited=0, req_partitions="a100,h100")
    obs = waits.observations(jobs, NOW)
    assert [(o["partition"], o["t"], o["event"]) for o in obs] == [("a100", 60, True), ("h100", 60, False)]
    pending = parse.parse_jobs(job_line(800, wait=None, state="PENDING"))[0]
    pending.update(limited=0, req_partitions=None)
    assert waits.observations([pending], NOW)[0]["t"] == 10000
    pending.update(end_ts=NOW-8000, state="CANCELLED")
    assert waits.observations([pending], NOW)[0]["t"] == 2000
    pending.update(limited=1)
    assert not waits.observations([pending], NOW)
    assert waits.observations([pending], NOW, True)
    pending.update(restarts=1)
    assert not waits.observations([pending], NOW, True)


def test_database_lock_checkpoint_permissions_and_attempts(tmp_path):
    path = tmp_path / "cluster.db"
    store = ClusterStore(path)
    try:
        with pytest.raises(ClusterDbLocked):
            ClusterStore(path)
        assert path.stat().st_mode & 0o777 == 0o600
        jobs = parse.parse_jobs(job_line(42, reason="MaxGRESPerAccount"))
        store.upsert_jobs(jobs, NOW, ("sacct_synced_to", NOW))
        jobs[0]["reason"] = "None"
        store.upsert_jobs(jobs, NOW+1)
        assert store.all("SELECT limited FROM jobs")[0]["limited"] == 1
        later = parse.parse_jobs(job_line(42, eligible=NOW-3000, restarts=1))
        store.upsert_jobs(later, NOW+2)
        assert store.all("SELECT count(*) n FROM jobs")[0]["n"] == 2
    finally:
        store.close()
    reopened = ClusterStore(path)
    assert reopened.meta("sacct_synced_to") == NOW
    reopened.close()


def test_queue_array_tasks_share_numeric_id_but_keep_individual_load_and_partitions(tmp_path):
    store = ClusterStore(tmp_path / "array.db")
    queue = parse.parse_queue(QUEUE)
    task0 = dict(queue[1], job_id=100, label="100_0", array_id=100)
    task1 = dict(task0, label="100_1")
    try:
        store.replace_queue([task0, task1, task0], NOW)
        rows = store.records("queue")
        assert len(rows) == 2
        assert parse.account_load(rows, [task0["account"]])[task0["account"]]["pend_gpus"] == 2
        job = parse.parse_jobs(job_line(101, label="100_1", partition="h200", account=task0["account"]))
        store.upsert_jobs(job, NOW)
        assert store.wait_jobs(NOW-20000)[0]["req_partitions"] == "h200,h200_condo"
    finally:
        store.close()


@pytest.mark.anyio
async def test_collection_views_and_failed_reads_preserve_data(tmp_path):
    fake = FakeSlurm()
    mon = make_monitor(tmp_path, fake)
    try:
        await mon.tick()
        ov = ClusterOverview.model_validate(views.overview(mon, NOW*1000, "viewer")).model_dump(by_alias=True)
        assert len(ov["groups"]) == 2
        assert ov["status"]["accounts"] == 2
        account = ov["groups"][0]["accounts"][0]
        assert account["userFairshare"] == .165 and account["budget"] is None
        assert account["capGpus"] == 32 and account["member"]
        assert len(ov["capacity"]) == 2 and ov["sampleMs"] == NOW*1000
        speed = QueueSpeedResponse.model_validate(views.queue_speed(mon, "24h", "ours", False, NOW*1000))
        assert speed.rows[0].p50_sec == 300
        trend = SeriesResponse.model_validate(views.series(mon, "groups", "24h", NOW*1000))
        assert trend.series and len(trend.t) == len(trend.estimated)
        before = mon.store.records("queue")
        fake.fail.update({"squeue", "sinfo", "sacct"})
        mon.last_sacct = None
        mon.clock = lambda: NOW+600
        await mon.tick()
        assert mon.store.records("queue") == before
        assert mon.store.meta("sacct_synced_to") == NOW
        assert "squeue" in mon.error and "sacct" in mon.error
        assert mon.store.meta("queue_ts") == NOW
        assert len(mon.store.all("SELECT DISTINCT ts FROM acct_samples WHERE est=0")) == 1
    finally:
        await mon.stop()


@pytest.mark.anyio
async def test_refresh_joins_collection_and_throttles(tmp_path):
    fake = FakeSlurm()
    gate = asyncio.Event()
    entered = asyncio.Event()

    async def slow(command, args):
        if command == "squeue":
            entered.set()
            await gate.wait()
        return await fake(command, args)

    mon = make_monitor(tmp_path, slow)
    try:
        first = asyncio.create_task(mon.refresh())
        await entered.wait()
        second = asyncio.create_task(mon.refresh())
        await asyncio.sleep(0)
        gate.set()
        await asyncio.gather(first, second)
        assert sum(c == "squeue" for c, _ in fake.calls) == 1
        with pytest.raises(RefreshThrottled):
            await mon.refresh()
    finally:
        await mon.stop()


@pytest.mark.anyio
async def test_startup_is_nonblocking_and_shutdown_releases_database(tmp_path):
    entered = asyncio.Event()

    async def stalled(command, args):
        entered.set()
        await asyncio.Event().wait()

    mon = ClusterMonitor(replace(ClusterConfig(), db_path=tmp_path / "cluster.db"), runner=stalled)
    await mon.start()
    await entered.wait()
    await asyncio.wait_for(mon.stop(), 2)
    assert mon._loop_task.done() and mon._tick_task.done()
    store = ClusterStore(mon.config.db_path)
    store.close()


@pytest.mark.anyio
async def test_missing_slurm_does_not_create_database(tmp_path, monkeypatch):
    monkeypatch.setattr("shutil.which", lambda cmd, **kwargs: None)
    mon = ClusterMonitor(replace(ClusterConfig(), db_path=tmp_path / "missing.db", transport="local"))
    await mon.start()
    assert not mon.available and "Slurm commands unavailable" in mon.error
    assert not mon.config.db_path.exists()


@pytest.mark.anyio
async def test_backfill_checkpoints_resume_fixed_windows_after_restart(tmp_path):
    fake = FakeSlurm()
    mon = make_monitor(tmp_path, fake, backfill_days=2, backfill_pause=0)
    mon.partitions = ["a100"]
    original = mon._history_window
    windows = []

    async def first_day_only(start, end, marker):
        windows.append((start, end))
        if len(windows) == 2:
            return "sacct: temporary failure"
        return await original(start, end, marker)

    mon._history_window = first_day_only
    await mon._backfill()
    assert mon.store.meta("backfill_done_days") == 1
    assert mon.store.meta("backfill_anchor") == NOW
    await mon.stop()

    # A later restart resumes day two relative to the original anchor, not to today's clock.
    resumed = make_monitor(tmp_path, FakeSlurm(), backfill_days=2, backfill_pause=0)
    resumed.clock = lambda: NOW + 7 * 86400
    resumed.partitions = ["a100"]
    original = resumed._history_window
    resumed_windows = []

    async def record_window(start, end, marker):
        resumed_windows.append((start, end))
        return await original(start, end, marker)

    resumed._history_window = record_window
    try:
        await resumed._backfill()
        assert resumed_windows == [windows[1]]
        assert resumed.store.meta("backfill_done_days") == 2
    finally:
        await resumed.stop()


def test_reconstruction_marks_gaps_and_uses_half_open_intervals():
    assert array_tasks("10_[1,3,7-9%2]") == 5
    assert gap_times([100, 1000], 300, 1000) == [400, 700]
    job = parse.parse_jobs(job_line(42, eligible=1000, wait=100))[0]
    job.update(submit_ts=50, eligible_ts=100, start_ts=200, end_ts=400, last_seen=500, limited=0, req_partitions="a100")
    samples = reconstruct([job], [100, 200, 400], {job["account"]}, lambda p: p, 500, 400)
    assert [s["accounts"][0]["run_gpus"] for s in samples] == [0, 1, 0]
    assert [s["accounts"][0]["pend_gpus_queue"] for s in samples] == [1, 0, 0]


@pytest.mark.anyio
async def test_command_timeout_and_cancel_reap_child():
    import sys
    result = await commands.run_command(sys.executable, ["-c", "import time; time.sleep(30)"], timeout=.02)
    assert result.code == 124
