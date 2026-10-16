"""Operator settings for the read-only Skipjack monitor."""
from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import re

PREFIX = "OBSERVATORY_MONITOR_"
DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "skipjack-monitor.sqlite3"


def env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    value = int(os.environ.get(PREFIX + name, default))
    if not minimum <= value <= maximum:
        raise ValueError(f"{PREFIX}{name} must be between {minimum} and {maximum}")
    return value


@dataclass(frozen=True)
class ClusterConfig:
    enabled: bool = True
    db_path: Path = DEFAULT_DB
    groups: tuple[tuple[str, str], ...] = (("bvandur1", "Ben"), ("dkhasha1", "Daniel"))
    partitions: tuple[str, ...] = ()
    transport: str = "auto"
    ssh_host: str = "skipjack"
    slurm_bin_dir: str = "/opt/mprov/cloack/slurm/current/bin"
    poll_seconds: int = 300
    history_seconds: int = 600
    metadata_seconds: int = 3600
    backfill_days: int = 14
    command_timeout: int = 60
    backfill_pause: float = 2
    jobs_days: int = 90
    samples_days: int = 60

    @classmethod
    def from_env(cls) -> "ClusterConfig":
        groups = []
        for item in os.environ.get(PREFIX + "GROUPS", "bvandur1:Ben,dkhasha1:Daniel").split(","):
            prefix, sep, label = item.strip().partition(":")
            if not re.fullmatch(r"[\w.-]+", prefix) or not sep or not label.strip():
                raise ValueError(f"{PREFIX}GROUPS must contain prefix:label pairs")
            if any(prefix == existing for existing, _ in groups):
                raise ValueError(f"{PREFIX}GROUPS contains duplicate prefix {prefix}")
            groups.append((prefix, label.strip()))
        partitions = tuple(p.strip() for p in os.environ.get(PREFIX + "PARTITIONS", "").split(",") if p.strip())
        if any(not re.fullmatch(r"[\w.-]+", p) for p in partitions):
            raise ValueError(f"{PREFIX}PARTITIONS must contain partition names")
        transport = os.environ.get(PREFIX + "TRANSPORT", "auto")
        if transport not in {"auto", "local", "ssh"}:
            raise ValueError(f"{PREFIX}TRANSPORT must be auto, local, or ssh")
        host = os.environ.get(PREFIX + "SSH_HOST", "skipjack")
        if not re.fullmatch(r"[\w][\w.@:-]*", host):
            raise ValueError(f"{PREFIX}SSH_HOST must be an SSH host or user@host")
        enabled = os.environ.get(PREFIX + "ENABLED", "true").lower()
        if enabled not in {"true", "false", "1", "0"}:
            raise ValueError(f"{PREFIX}ENABLED must be true or false")
        return cls(
            enabled=enabled in {"true", "1"},
            db_path=Path(os.environ.get(PREFIX + "DB", str(DEFAULT_DB))).expanduser(),
            groups=tuple(groups), partitions=partitions, transport=transport, ssh_host=host,
            slurm_bin_dir=os.environ.get(PREFIX + "SLURM_BIN_DIR", cls.slurm_bin_dir),
            poll_seconds=env_int("POLL_SECONDS", 300, 60, 86400),
            backfill_days=env_int("BACKFILL_DAYS", 14, 0, 90),
            command_timeout=env_int("COMMAND_TIMEOUT", 60, 1, 300),
        )
