"""Transport checks use fake Slurm executables and never connect to a cluster."""
import asyncio
from dataclasses import replace
import json
import sys

import pytest

from monitor import transport
from monitor.collector import ClusterMonitor
from monitor.commands import CommandResult, REQUIRED_COMMANDS, run_command
from monitor.config import ClusterConfig


def test_config_validation_and_defaults(monkeypatch):
    config = ClusterConfig.from_env()
    assert config.groups == (("bvandur1", "Ben"), ("dkhasha1", "Daniel"))
    for name, value in (("TRANSPORT", "invalid"), ("SSH_HOST", "-oProxyCommand=bad"),
                        ("PARTITIONS", "a100;bad"), ("GROUPS", "a:A,a:B"),
                        ("POLL_SECONDS", "1"), ("BACKFILL_DAYS", "91"), ("ENABLED", "maybe")):
        with monkeypatch.context() as patch:
            patch.setenv("OBSERVATORY_MONITOR_" + name, value)
            with pytest.raises(ValueError):
                ClusterConfig.from_env()


def test_auto_selects_local_or_ssh(monkeypatch):
    monkeypatch.setattr(transport.shutil, "which", lambda *args, **kwargs: "/bin/fake")
    assert transport.SlurmTransport(ClusterConfig()).mode == "local"
    monkeypatch.setattr(transport.shutil, "which", lambda *args, **kwargs: None)
    assert transport.SlurmTransport(ClusterConfig()).mode == "ssh"


@pytest.mark.anyio
async def test_local_transport_sanitizes_env_and_uses_configured_path(tmp_path, monkeypatch):
    program = tmp_path / "squeue"
    program.write_text(f'#!{sys.executable}\nimport os,json,sys\nprint(json.dumps([sys.argv[1:],os.environ.get("SLURM_JOB_ID"),os.environ["SLURM_TIME_FORMAT"]]))\n')
    program.chmod(0o700)
    monkeypatch.setenv("SLURM_JOB_ID", "123")
    runner = transport.SlurmTransport(ClusterConfig(transport="local", slurm_bin_dir=str(tmp_path)))
    result = await runner("squeue", ["literal;argument"])
    assert result.code == 0 and json.loads(result.stdout) == [["literal;argument"], None, "%s"]
    assert (await runner("sbatch", [])).code == 126


@pytest.mark.anyio
async def test_ssh_payload_is_bounded_argv_execution(tmp_path, monkeypatch):
    for command in REQUIRED_COMMANDS:
        program = tmp_path / command
        program.write_text(f'#!{sys.executable}\nimport json,sys,os,time\nif "sleep" in sys.argv: time.sleep(10)\nprint(json.dumps([sys.argv[1:],os.environ.get("SBATCH_ACCOUNT"),os.environ["SLURM_TIME_FORMAT"]]))\n')
        program.chmod(0o700)
    calls = []

    async def fake_ssh(command, args, timeout, **kwargs):
        assert command == "ssh" and args[-3:] == ["test-host", "python3", "-"]
        assert "BatchMode=yes" in args and "ConnectTimeout=10" in args
        calls.append(args)
        return await run_command(sys.executable, ["-"], timeout, **kwargs)

    monkeypatch.setattr(transport, "run_command", fake_ssh)
    monkeypatch.setenv("SBATCH_ACCOUNT", "unexpected")
    runner = transport.SlurmTransport(ClusterConfig(transport="ssh", ssh_host="test-host", slurm_bin_dir=str(tmp_path), command_timeout=.1))
    assert await runner.preflight()
    result = await runner("squeue", ["hello; $(false)", "space and 'quote'"])
    assert result.code == 0
    assert json.loads(result.stdout) == [["hello; $(false)", "space and 'quote'"], None, "%s"]
    timed = await runner("squeue", ["sleep"])
    assert timed.code == 124 and "remote" in timed.stderr
    assert len(calls) == 3


@pytest.mark.anyio
async def test_ssh_failure_is_visible_and_shutdown_releases_db(tmp_path, monkeypatch):
    entered = asyncio.Event()
    async def fail(self):
        entered.set()
        raise RuntimeError("SSH connection failed")
    monkeypatch.setattr(transport.SlurmTransport, "preflight", fail)
    monitor = ClusterMonitor(ClusterConfig(transport="ssh", db_path=tmp_path / "monitor.db"))
    await monitor.start()
    await entered.wait()
    assert not monitor.available and "SSH connection failed" in monitor.error
    await monitor.stop()
    from monitor.store import ClusterStore
    ClusterStore(monitor.config.db_path).close()


@pytest.mark.anyio
async def test_cancel_reaps_local_subprocess(tmp_path):
    marker = tmp_path / "finished"
    task = asyncio.create_task(run_command(sys.executable, ["-c", f"import time,pathlib; time.sleep(.3); pathlib.Path({str(marker)!r}).touch()"], 10))
    await asyncio.sleep(.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await asyncio.sleep(.4)
    assert not marker.exists()
