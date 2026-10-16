"""Small offline Skipjack command fixtures; never invokes real Slurm."""

from monitor.commands import CommandResult
from monitor.parse import SEP

NOW = 1_791_000_000
ASSOC = "\n".join([
    "bvandur1_blabscify|pi-bvandur1||jhu2||billing=6000000000",
    "bvandur1_blabscify||viewer|jhu2||",
    "dkhasha1_safety|pi-dkhasha1||jhu4||billing=6000000000",
    "dkhasha1_safety||viewer|jhu4||",
    "dkhasha1_main|pi-dkhasha1||jhu4||",  # parent only
    "bvandur1x||viewer|jhu2||",          # prefix lookalike
])
QOS = "jhu2||gres/gpu=32|gres/gpu=32|1000|1000\njhu4||gres/gpu=64|gres/gpu=64|1000|1000"
PARTITIONS = "\n".join([
    "PartitionName=a100 Hidden=NO NodeSets=a100 PriorityTier=1 MaxCPUsPerNode=88 TRES=gres/gpu=8",
    "PartitionName=h200 Hidden=NO NodeSets=h200 PriorityTier=1 MaxCPUsPerNode=124 TRES=gres/gpu=4",
    "PartitionName=h200_condo Hidden=YES NodeSets=h200 PriorityTier=10 TRES=gres/gpu=4",
    "PartitionName=med Hidden=NO NodeSets=med PriorityTier=1 TRES=cpu=1000",
])
NODES = "\n".join([
    "ga01 a100 mix gpu:a100:8 gpu:a100:2(IDX:0-1) 16/112/0/128 800000 100000",
    "gh01 h200 mix- gpu:h200:4 gpu:h200:1(IDX:0) 8/116/0/124 1500000 100000",
    "gh01 h200_condo mix- gpu:h200:4 gpu:h200:1(IDX:0) 8/116/0/124 1500000 100000",
])
QUEUE = "\n".join([
    f"10|10|10|bvandur1_blabscify|viewer|R|a100|cpu=8,mem=64G,gres/gpu=2|04:00:00|{NOW-6000}|{NOW-6000}|{NOW-5000}|None|jhu2|5000|",
    f"11|11|11|dkhasha1_safety|viewer|PD|h200,h200_condo|cpu=8,mem=64G,gres/gpu=1|01:00:00|{NOW-4000}|{NOW-3600}|N/A|Priority|jhu4|3000|",
    f"12|12|12|dkhasha1_safety|viewer|PD|a100|cpu=8,mem=64G,gres/gpu=4|12:00:00|{NOW-4000}|{NOW-3600}|N/A|MaxGRESPerAccount|jhu4|3000|",
])
SHARES = "\n".join([
    "bvandur1_blabscify||100|0.1|1000|0.1||0.4|billing=6000000000|billing=10000|billing=1000",
    "bvandur1_blabscify|viewer|1|1|100|0.01|0.165|inf||billing=0|billing=0",
    "dkhasha1_safety||100|0.1|2000|0.2||0.3|billing=6000000000|billing=20000|billing=2000",
    "dkhasha1_safety|viewer|1|1|200|0.02|0.193|inf||billing=0|billing=0",
])


def job_line(job_id=100, *, eligible=NOW-10000, wait=600, state="COMPLETED", reason="None", account="bvandur1_blabscify", label=None, restarts=0, reservation="", partition="a100", gpus=1):
    start = str(eligible + wait) if wait is not None else "Unknown"
    end = str(eligible + wait + 300) if wait is not None else "Unknown"
    return SEP.join(map(str, [job_id, label or job_id, account, "viewer", partition, "jhu2",
                              f"cpu=8,mem=64G,gres/gpu={gpus},node=1", "01:00:00", eligible-500,
                              eligible, start, end, state, reason, restarts, 5000, reservation]))


JOBS = "\n".join(job_line(100 + i, eligible=NOW-60000-i*600, wait=(i+1)*60) for i in range(10))


class FakeSlurm:
    def __init__(self):
        self.calls = []
        self.fail = set()

    async def __call__(self, command, args):
        self.calls.append((command, args))
        if command in self.fail:
            return CommandResult(1, stderr="temporarily unavailable")
        if command == "sacctmgr":
            return CommandResult(0, QOS if "qos" in args else ASSOC)
        return CommandResult(0, {"squeue": QUEUE, "sinfo": NODES, "scontrol": PARTITIONS,
                                 "sshare": SHARES, "sacct": JOBS}[command])
