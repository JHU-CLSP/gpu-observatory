"""Scheduler probes never submit jobs; use fake commands and a controlled clock."""
import asyncio
import json
import sys

import httpx
import pytest

import app as application
from monitor import routes, transport
from monitor.commands import CommandResult, PROBE_TIME_LIMITS, REQUIRED_COMMANDS, probe_args, run_command
from monitor.config import ClusterConfig
from monitor.probes import CACHE_SECONDS, MIN_BATCH_SECONDS, TIME_LIMIT_BATCHES, ProbeThrottled, parse_estimate
from tests.fixtures.cluster import NOW
from tests.test_monitor import make_monitor


class FakeProbeTransport:
    username = 'viewer'
    can_probe = True

    def __init__(self):
        self.calls = []
        self.entered = asyncio.Event()
        self.release = asyncio.Event()
        self.release.set()

    async def test_start(self, *args):
        self.calls.append(args)
        self.entered.set()
        await self.release.wait()
        if args[2] == 8:
            return CommandResult(1, stderr='Requested node configuration is not available')
        return CommandResult(0, stderr=f'site warning\nsbatch: Job 123 to start at {NOW + 3600} a using 8 processors on nodes test in partition a100')


async def setup_monitor(tmp_path):
    mon = make_monitor(tmp_path)
    await mon.tick()
    mon.transport = FakeProbeTransport()
    mon.probes.pause_seconds = 0
    return mon


def test_parser_handles_epoch_iso_errors_and_missing_estimates():
    result = parse_estimate(CommandResult(0, stderr=f'warning\nsbatch: Job 2 to start at {NOW + 600} using 8 processors'), NOW * 1000, 'UTC')
    assert result['estimated_start_ms'] == (NOW + 600) * 1000
    assert result['wait_sec'] == 600 and 'warning' in result['output']
    iso = parse_estimate(CommandResult(0, 'sbatch: Job 1 to start at 2026-01-01T12:00:00 using 8 processors'), NOW * 1000, 'America/New_York')
    assert iso['estimated_start_ms'] == 1767286800000
    for result in (CommandResult(0, 'Job cannot be scheduled now'), CommandResult(1, stderr=f'error: to start at {NOW + 600}')):
        parsed = parse_estimate(result, NOW * 1000, 'UTC')
        assert parsed['estimated_start_ms'] is None and parsed['wait_sec'] is None
    with pytest.raises(ValueError):
        probe_args('a --uid=root', 'a100', 1, 60, 8, 64)
    with pytest.raises(ValueError):
        probe_args('test_account', 'a100', 1, 120, 8, 64)


@pytest.mark.anyio
@pytest.mark.parametrize('mode', ['local', 'ssh'])
@pytest.mark.parametrize('minutes', PROBE_TIME_LIMITS)
async def test_only_guard_and_environment_on_both_transports(tmp_path, monkeypatch, mode, minutes):
    for name in (*REQUIRED_COMMANDS, 'sbatch'):
        program = tmp_path / name
        program.write_text(f'#!{sys.executable}\nimport os,json,sys\nprint(json.dumps([sys.argv[1:],os.environ.get("SBATCH_ACCOUNT"),os.environ.get("SLURM_JOB_ID")]))\n')
        program.chmod(0o700)
    async def fake_ssh(command, args, timeout, **kwargs):
        assert command == 'ssh'
        return await run_command(sys.executable, ['-'], timeout, **kwargs)
    if mode == 'ssh':
        monkeypatch.setattr(transport, 'run_command', fake_ssh)
    monkeypatch.setenv('SBATCH_ACCOUNT', 'unwanted')
    monkeypatch.setenv('SLURM_JOB_ID', 'unwanted')
    runner = transport.SlurmTransport(ClusterConfig(transport=mode, ssh_host='test-host', slurm_bin_dir=str(tmp_path)))
    if mode == 'ssh':
        await runner.preflight()
    result = await runner.test_start('test_account', 'a100', 4, minutes, 32, 256)
    args, account_env, job_env = json.loads(result.stdout)
    assert args[:2] == ['--test-only', '--wrap=true']
    assert '--gres=gpu:4' in args and f'--time={minutes}' in args and '--mem=256G' in args
    assert account_env is None and job_env is None
    assert (await runner('sbatch', ['--wrap=true'])).code == 126
    with pytest.raises(ValueError):
        await runner.test_start('account', 'a100;bad', 4, 1440, 32, 256)


@pytest.mark.anyio
async def test_cached_api_alternates_halves_and_preserves_rows_across_restart(tmp_path, monkeypatch):
    mon = await setup_monitor(tmp_path)
    accounts = mon.store.records('accounts')
    parents = [dict(accounts[0], account=prefix) for prefix, _ in mon.config.groups]
    mon.store.replace_metadata('accounts', accounts + parents, 'account')
    monkeypatch.setattr(routes, 'monitor', mon)
    base = '/stats/skipjack/monitor/start-estimates'
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application.app), base_url='http://test') as client:
            initial = (await client.get(base)).json()
            assert initial['probeUser'] == 'viewer' and initial['rows'] == []
            assert initial['accounts'] == ['bvandur1_blabscify', 'dkhasha1_safety']
            assert initial['account'] == 'bvandur1_blabscify'
            assert initial['cpusPerGpu'] == 8
            assert initial['timeLimitsMinutes'] == list(PROBE_TIME_LIMITS)
            assert initial['nextTimeLimitsMinutes'] == list(TIME_LIMIT_BATCHES[0])
            for parent in parents:
                for method in ('GET', 'POST'):
                    assert (await client.request(method, base, params={'account': parent['account']})).status_code == 422
            assert {a['account'] for a in parents} <= {a['account'] for a in mon.store.records('accounts')}
            assert not mon.transport.calls
            for params in ({'account': 'not-a-member'}, {'partition': 'unknown'}, {'cpus_per_gpu': 0}, {'memory_gib_per_gpu': 257}):
                assert (await client.post(base, params=params)).status_code == 422
            result = await client.post(base)
            assert result.status_code == 200
            data = result.json()
            assert len(data['rows']) == 9 and len(mon.transport.calls) == 9
            assert {(r['gpus'], r['timeLimitMinutes']) for r in data['rows']} == {(g, t) for g in (1, 4, 8) for t in TIME_LIMIT_BATCHES[0]}
            assert data['nextTimeLimitsMinutes'] == list(TIME_LIMIT_BATCHES[1])
            assert all(call[4] == 8 * call[2] and call[5] == 64 * call[2] for call in mon.transport.calls)
            assert data['rows'][-1]['estimatedStartMs'] is None and data['rows'][-1]['status'] == 'error'
            await client.post(base)
            await client.get(base, params={'user': 'someone-else'})
            assert len(mon.transport.calls) == 9
            assert (await client.get(base, params={'cpus_per_gpu': 4})).json()['rows'] == []
            assert len(mon.transport.calls) == 9
            limited = await client.post(base, params={'cpus_per_gpu': 4})
            assert limited.status_code == 429 and limited.headers['Retry-After'] == '60'
    finally:
        await mon.stop()
    resumed = await setup_monitor(tmp_path)
    try:
        cached = await resumed.probes.refresh()
        assert len(cached['rows']) == 9 and not resumed.transport.calls
        resumed.clock = lambda: NOW + CACHE_SECONDS + 1
        second = await resumed.probes.refresh()
        assert len(second['rows']) == 18 and len(resumed.transport.calls) == 9
        assert {call[3] for call in resumed.transport.calls} == set(TIME_LIMIT_BATCHES[1])
        assert second['next_time_limits_minutes'] == list(TIME_LIMIT_BATCHES[0])
        assert [r for r in second['rows'] if r['time_limit_minutes'] in TIME_LIMIT_BATCHES[0]] == cached['rows']
        resumed.clock = lambda: NOW + 2 * (CACHE_SECONDS + 1)
        third = await resumed.probes.refresh()
        assert len(third['rows']) == 18 and len(resumed.transport.calls) == 18
        assert third['next_time_limits_minutes'] == list(TIME_LIMIT_BATCHES[1])
        assert [r for r in third['rows'] if r['time_limit_minutes'] in TIME_LIMIT_BATCHES[1]] == [r for r in second['rows'] if r['time_limit_minutes'] in TIME_LIMIT_BATCHES[1]]
        assert all(r['checked_at_ms'] == int(resumed.clock() * 1000) for r in third['rows'] if r['time_limit_minutes'] in TIME_LIMIT_BATCHES[0])
        # An explicitly requested CPU configuration starts its own first half.
        resumed.clock = lambda: NOW + 2 * (CACHE_SECONDS + 1) + MIN_BATCH_SECONDS + 1
        custom = await resumed.probes.refresh(cpus_per_gpu=4)
        assert len(custom['rows']) == 9 and custom['next_time_limits_minutes'] == list(TIME_LIMIT_BATCHES[1])
        assert all(r['cpus'] == r['gpus'] * 4 for r in custom['rows'])
        assert resumed.probes.snapshot()[0]['rows'] == third['rows']
    finally:
        await resumed.stop()


@pytest.mark.anyio
async def test_concurrent_browsers_join_and_disconnect_does_not_duplicate(tmp_path):
    mon = await setup_monitor(tmp_path)
    mon.transport.release.clear()
    first = asyncio.create_task(mon.probes.refresh())
    await mon.transport.entered.wait()
    second = asyncio.create_task(mon.probes.refresh())
    try:
        with pytest.raises(ProbeThrottled):
            await mon.probes.refresh(cpus_per_gpu=4)
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        mon.transport.release.set()
        result = await second
        assert len(result['rows']) == 9 and len(mon.transport.calls) == 9
    finally:
        await mon.stop()


@pytest.mark.anyio
async def test_shutdown_cancels_probe_before_closing_store(tmp_path):
    mon = await setup_monitor(tmp_path)
    mon.transport.release.clear()
    request = asyncio.create_task(mon.probes.refresh())
    await mon.transport.entered.wait()
    await asyncio.wait_for(mon.stop(), 2)
    with pytest.raises(asyncio.CancelledError):
        await request
    assert mon.store is None and mon.probes.task.done()
