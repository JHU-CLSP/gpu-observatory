"""Local and SSH execution of the monitor's fixed read-only command set.

The SSH payload executes argv directly on the remote host. It writes no files
and enforces a remote deadline as well as the client's SSH deadline.
"""
from __future__ import annotations

import json
import os
import shutil

from .commands import CommandResult, REQUIRED_COMMANDS, command_env, run_command

REMOTE_SCRIPT = r'''
import json, os, pathlib, shutil, signal, subprocess, sys
request = REQUEST
allowed = ("squeue", "sinfo", "sshare", "sacct", "sacctmgr", "scontrol")
env = {k: v for k, v in os.environ.items() if not k.startswith(("SLURM_", "SBATCH_", "SRUN_", "SLURMD_")) or k == "SLURM_CONF"}
env.update(LC_ALL="C", SLURM_TIME_FORMAT="%s")
if request["bin_dir"]:
    env["PATH"] = request["bin_dir"] + os.pathsep + env.get("PATH", "")
if request["command"] == "preflight":
    path = str(pathlib.Path("/etc/localtime").resolve())
    zone = env.get("TZ") or (path.split("/zoneinfo/")[-1] if "/zoneinfo/" in path else "UTC")
    print(json.dumps({"missing": [c for c in allowed if shutil.which(c, path=env.get("PATH")) is None], "timezone": zone}))
    sys.exit(0)
if request["command"] not in allowed:
    sys.exit("Unsupported monitor command")
try:
    proc = subprocess.Popen([request["command"]] + request["args"], env=env,
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
except OSError as exc:
    sys.exit(str(exc))
try:
    out, err = proc.communicate(timeout=request["timeout"])
except subprocess.TimeoutExpired:
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    proc.communicate()
    sys.stderr.write(request["command"] + " timed out on remote host")
    sys.exit(124)
sys.stdout.buffer.write(out)
sys.stderr.buffer.write(err)
sys.exit(proc.returncode)
'''


class SlurmTransport:
    def __init__(self, config):
        self.config = config
        self.env = command_env()
        if config.slurm_bin_dir:
            self.env["PATH"] = config.slurm_bin_dir + os.pathsep + self.env.get("PATH", "")
        self.missing = [c for c in REQUIRED_COMMANDS if shutil.which(c, path=self.env.get("PATH")) is None]
        self.mode = config.transport
        if self.mode == "auto":
            self.mode = "local" if not self.missing else "ssh"

    async def __call__(self, command, args):
        if command not in REQUIRED_COMMANDS:
            return CommandResult(126, stderr="Unsupported monitor command")
        if self.mode == "local":
            return await run_command(command, args, self.config.command_timeout, env=self.env)
        return await self._ssh(command, args)

    async def _ssh(self, command, args):
        payload = json.dumps(dict(command=command, args=args, timeout=self.config.command_timeout,
                                  bin_dir=self.config.slurm_bin_dir))
        script = "REQUEST = " + repr(json.loads(payload)) + "\n" + REMOTE_SCRIPT
        return await run_command("ssh", ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
                                         self.config.ssh_host, "python3", "-"],
                                 self.config.command_timeout + 15, input_data=script.encode())

    async def preflight(self):
        result = await self._ssh("preflight", [])
        if result.code:
            raise RuntimeError("Skipjack SSH: " + (result.stderr.strip() or "connection failed"))
        try:
            data = json.loads(result.stdout)
            missing, zone = data["missing"], data["timezone"]
            if not isinstance(missing, list) or not isinstance(zone, str):
                raise ValueError("invalid preflight fields")
        except (ValueError, KeyError, TypeError) as exc:
            raise RuntimeError("Skipjack SSH returned invalid preflight data") from exc
        if missing:
            raise RuntimeError("Remote Slurm commands unavailable: " + ", ".join(missing))
        return zone
