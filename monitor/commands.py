"""Bounded Slurm subprocesses; the monitor's call sites are read-only."""
from __future__ import annotations


import asyncio
from dataclasses import dataclass
import os
import re
import signal

from .parse import SEP

SACCT_FIELDS = "JobIDRaw,JobID,Account,User,Partition,QOS,ReqTRES,Timelimit,Submit,Eligible,Start,End,State,Reason,Restarts,Priority,Reservation"
QUEUE_FIELDS = "JobID,JobArrayID,ArrayJobID,Account,UserName,StateCompact,Partition,tres-alloc,TimeLimit,SubmitTime,EligibleTime,StartTime,Reason,QOS,PriorityLong".split(",")
NODE_FORMAT = "NodeList:40,Partition:40,StateLong:24,Gres:80,GresUsed:120,CPUsState:30,Memory:16,AllocMem:16"
SHARE_FIELDS = "Account,User,RawShares,NormShares,RawUsage,EffectvUsage,FairShare,LevelFS,GrpTRESMins,GrpTRESRaw,TRESRunMins"
ASSOC_ARGS = ["-nP", "show", "assoc", "format=Account,ParentName,User,QOS,GrpTRES,GrpTRESMins"]
PARTITION_ARGS = ["-a", "-o", "show", "partition"]
REQUIRED_COMMANDS = ("squeue", "sinfo", "sshare", "sacct", "sacctmgr", "scontrol")
PROBE_TIME_LIMITS = (60, 240, 720, 1440, 2880, 4320)


def probe_args(account: str, partition: str, gpus: int, minutes: int, cpus: int, memory_gib: int) -> list[str]:
    """Fixed single-node test request. No user-supplied scripts or Slurm options."""
    if not all(re.fullmatch(r"[\w.-]+", name) for name in (account, partition)):
        raise ValueError("Invalid account or partition")
    if gpus not in (1, 4, 8) or minutes not in PROBE_TIME_LIMITS or not 1 <= cpus <= 256 or not 1 <= memory_gib <= 2048:
        raise ValueError("Unsupported probe size")
    return [f"--account={account}", f"--partition={partition}", "--nodes=1", "--ntasks=1",
            f"--gres=gpu:{gpus}", f"--cpus-per-task={cpus}", f"--mem={memory_gib}G", f"--time={minutes}"]


def command_env() -> dict[str, str]:
    return {**{k: v for k, v in os.environ.items() if (
        not k.startswith(("SLURM_", "SBATCH_", "SRUN_", "SLURMD_")) or k == "SLURM_CONF")
        and k not in {"RCB_RUN_DIR", "RCB_RUN_ID"}}, "LC_ALL": "C", "SLURM_TIME_FORMAT": "%s"}


def queue_args(parts: list[str]) -> list[str]:
    return ["-a", "-h", "-r", "-t", "PD,R,CG,S", "-p", ",".join(parts), "-O", ",".join(f"{f}:|" for f in QUEUE_FIELDS)]


def nodes_args(parts: list[str]) -> list[str]:
    # sinfo rejects -a together with -p; naming hidden lanes via -p exposes them.
    return ["-h", "-N", "-p", ",".join(parts), "-O", NODE_FORMAT]


def sacct_args(parts: list[str], from_minutes: int, to_minutes: int = 0) -> list[str]:
    relative = lambda n: f"now-{n}minutes" if n > 0 else "now"
    return ["-a", "-X", "-D", "-n", "-P", f"--delimiter={SEP}", "-r", ",".join(parts),
            "-S", relative(from_minutes), "-E", relative(to_minutes), "-o", SACCT_FIELDS]


@dataclass(frozen=True)
class CommandResult:
    code: int
    stdout: str = ""
    stderr: str = ""


async def run_command(command: str, args: list[str], timeout: int = 60, *, env=None, input_data=None) -> CommandResult:
    try:
        process = await asyncio.create_subprocess_exec(command, *args, env=env if env is not None else command_env(), start_new_session=True,
                                                       stdin=asyncio.subprocess.PIPE if input_data is not None else asyncio.subprocess.DEVNULL,
                                                       stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    except OSError as e:
        return CommandResult(127, stderr=str(e))
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(input_data), timeout)
        return CommandResult(process.returncode, stdout.decode(errors="replace"), stderr.decode(errors="replace"))
    except (asyncio.TimeoutError, asyncio.CancelledError) as e:
        # Reap the process before returning/re-raising; shutdown leaves no CLI children behind.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await process.wait()
        if isinstance(e, asyncio.CancelledError):
            raise
        return CommandResult(124, stderr=f"{command} timed out after {timeout}s")
