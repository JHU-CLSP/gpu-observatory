"""One private SQLite database, one writer, and durable history checkpoints."""
from __future__ import annotations


import json
import os
from pathlib import Path
import sqlite3
import threading

from .parse import is_limited

JOB_FIELDS = ("job_id", "submit_ts", "label", "array_id", "array_meta", "account", "user", "partition", "qos",
              "gpus", "cpus", "mem_mb", "nodes", "timelimit_s", "eligible_ts", "start_ts", "end_ts", "state",
              "reason", "restarts", "priority", "reservation")

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accounts (name TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS partitions (name TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS queue (label TEXT PRIMARY KEY, job_id INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (
  job_id INTEGER NOT NULL, submit_ts INTEGER NOT NULL, label TEXT NOT NULL,
  array_id INTEGER, array_meta INTEGER NOT NULL, account TEXT NOT NULL, user TEXT NOT NULL,
  partition TEXT NOT NULL, qos TEXT NOT NULL, gpus INTEGER NOT NULL, cpus INTEGER NOT NULL,
  mem_mb INTEGER, nodes INTEGER NOT NULL, timelimit_s INTEGER, eligible_ts INTEGER,
  start_ts INTEGER, end_ts INTEGER, state TEXT NOT NULL, reason TEXT NOT NULL,
  restarts INTEGER NOT NULL, priority INTEGER, reservation TEXT, limited INTEGER NOT NULL,
  last_seen INTEGER NOT NULL, PRIMARY KEY (job_id, submit_ts)
);
CREATE INDEX IF NOT EXISTS jobs_eligible ON jobs(eligible_ts);
CREATE INDEX IF NOT EXISTS jobs_end ON jobs(end_ts);
CREATE INDEX IF NOT EXISTS jobs_label ON jobs(label);
CREATE TABLE IF NOT EXISTS req_parts (label TEXT PRIMARY KEY, partitions TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS acct_samples (
  account TEXT NOT NULL, ts INTEGER NOT NULL, run_gpus INTEGER NOT NULL, run_jobs INTEGER NOT NULL,
  pend_gpus INTEGER NOT NULL, pend_gpus_queue INTEGER NOT NULL, pend_jobs INTEGER NOT NULL,
  est INTEGER NOT NULL, PRIMARY KEY(account, ts)
);
CREATE TABLE IF NOT EXISTS pool_samples (
  pool TEXT NOT NULL, ts INTEGER NOT NULL, total INTEGER NOT NULL, used INTEGER NOT NULL,
  idle INTEGER NOT NULL, planned INTEGER NOT NULL, down INTEGER NOT NULL, reserved INTEGER NOT NULL,
  pend_gpus_queue INTEGER NOT NULL, est INTEGER NOT NULL, PRIMARY KEY(pool, ts)
);
CREATE TABLE IF NOT EXISTS shares (account TEXT NOT NULL, ts INTEGER NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY(account, ts));
CREATE TABLE IF NOT EXISTS user_shares (account TEXT NOT NULL, user TEXT NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY(account, user));
PRAGMA user_version=1;
"""


class ClusterDbLocked(RuntimeError):
    pass


class ClusterStore:
    """All callers hold lock across a view or transaction; used on worker threads."""

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            pass
        else:
            os.close(fd)
        self.db = sqlite3.connect(path, timeout=0, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        try:
            self.db.execute("PRAGMA locking_mode=EXCLUSIVE")
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.execute("PRAGMA synchronous=FULL")
            self.db.execute("BEGIN IMMEDIATE")
            self.db.commit()
            self.db.executescript(SCHEMA)
            for file in (path, Path(str(path) + "-wal"), Path(str(path) + "-shm")):
                if file.exists():
                    file.chmod(0o600)
        except Exception as e:
            self.db.close()
            if isinstance(e, sqlite3.OperationalError) and "locked" in str(e):
                raise ClusterDbLocked("Another observatory process owns the cluster database") from e
            raise

    def close(self):
        with self.lock:
            self.db.close()

    def all(self, sql: str, *params) -> list[dict]:
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, params)]

    def meta(self, key: str, default=None):
        rows = self.all("SELECT value FROM meta WHERE key=?", key)
        return json.loads(rows[0]["value"]) if rows else default

    def set_meta(self, key: str, value):
        with self.lock, self.db:
            self.db.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", (key, json.dumps(value)))

    def records(self, table: str) -> list[dict]:
        if table not in {"accounts", "partitions", "queue"}:
            raise ValueError(table)
        return [json.loads(r["data"]) for r in self.all(f"SELECT data FROM {table}")]

    def replace_metadata(self, table: str, rows: list[dict], key: str):
        if table not in {"accounts", "partitions"}:
            raise ValueError(table)
        with self.lock, self.db:
            self.db.execute(f"DELETE FROM {table}")
            self.db.executemany(f"INSERT INTO {table} VALUES (?,?)", [(r[key], json.dumps(r)) for r in rows])

    def replace_queue(self, rows: list[dict], now: int):
        with self.lock, self.db:
            self.db.execute("DELETE FROM queue")
            # squeue JobID repeats the array's id; JobArrayID identifies each expanded task.
            self.db.executemany("INSERT OR REPLACE INTO queue VALUES (?,?,?)", [(r["label"], r["job_id"], json.dumps(r)) for r in rows])
            self.db.executemany("INSERT OR REPLACE INTO req_parts VALUES (?,?)",
                                [(r["label"], ",".join(r["partitions"])) for r in rows if r["state"] == "PD"])
            self.db.executemany("UPDATE jobs SET limited=1 WHERE label=? AND start_ts IS NULL",
                                [(r["label"],) for r in rows if r["state"] == "PD" and is_limited(r["reason"])])
            self.db.execute("INSERT OR REPLACE INTO meta VALUES ('queue_ts', ?)", (json.dumps(now),))

    def upsert_jobs(self, jobs: list[dict], now: int, marker: tuple[str, int] | None = None):
        columns = (*JOB_FIELDS, "limited", "last_seen")
        updates = ",".join(f"{k}=excluded.{k}" for k in JOB_FIELDS if k not in {"job_id", "submit_ts"})
        # Once a wait was observed limit-bound, a later Priority reason must not erase it.
        updates += ",limited=max(jobs.limited,excluded.limited),last_seen=excluded.last_seen"
        sql = f"INSERT INTO jobs ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)}) ON CONFLICT(job_id,submit_ts) DO UPDATE SET {updates}"
        with self.lock, self.db:
            self.db.executemany(sql, [tuple(j[k] for k in JOB_FIELDS) + (int(is_limited(j["reason"])), now) for j in jobs])
            if marker:
                self.db.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", (marker[0], json.dumps(marker[1])))
            self.db.execute("INSERT OR REPLACE INTO meta VALUES ('history_revision', ?)",
                            (json.dumps(self.meta("history_revision", 0) + 1),))

    def add_samples(self, now: int, accounts: list[dict], pools: list[dict], estimated=False):
        af = ("account", "run_gpus", "run_jobs", "pend_gpus", "pend_gpus_queue", "pend_jobs")
        pf = ("pool", "total", "used", "idle", "planned", "down", "reserved", "pend_gpus_queue")
        mode = "IGNORE" if estimated else "REPLACE"
        with self.lock, self.db:
            self.db.executemany(f"INSERT OR {mode} INTO acct_samples VALUES (?,?,?,?,?,?,?,?)",
                                [(a[af[0]], now, *(a[k] for k in af[1:]), int(estimated)) for a in accounts])
            self.db.executemany(f"INSERT OR {mode} INTO pool_samples VALUES (?,?,?,?,?,?,?,?,?,?)",
                                [(p[pf[0]], now, *(p[k] for k in pf[1:]), int(estimated)) for p in pools])

    def add_shares(self, now: int, shares: list[dict]):
        with self.lock, self.db:
            self.db.executemany("INSERT OR REPLACE INTO shares VALUES (?,?,?)",
                                [(s["account"], now, json.dumps(s)) for s in shares if s["user"] is None])
            # A successful read is a full snapshot, including users who are now idle.
            self.db.execute("DELETE FROM user_shares")
            self.db.executemany("INSERT OR REPLACE INTO user_shares VALUES (?,?,?)",
                                [(s["account"], s["user"], json.dumps(s)) for s in shares if s["user"] is not None])

    def add_reconstructed(self, samples: list[dict]):
        # Thousands of points in a single durable transaction, rather than one fsync per point.
        af = ("run_gpus", "run_jobs", "pend_gpus", "pend_gpus_queue", "pend_jobs")
        pf = ("total", "used", "idle", "planned", "down", "reserved", "pend_gpus_queue")
        with self.lock, self.db:
            self.db.executemany("INSERT OR IGNORE INTO acct_samples VALUES (?,?,?,?,?,?,?,?)",
                                [(a["account"], s["ts"], *(a[k] for k in af), 1) for s in samples for a in s["accounts"]])
            self.db.executemany("INSERT OR IGNORE INTO pool_samples VALUES (?,?,?,?,?,?,?,?,?,?)",
                                [(p["pool"], s["ts"], *(p[k] for k in pf), 1) for s in samples for p in s["pools"]])

    def wait_jobs(self, since: int) -> list[dict]:
        return self.all("SELECT j.*, r.partitions req_partitions FROM jobs j LEFT JOIN req_parts r ON r.label=j.label WHERE j.eligible_ts>=?", since)

    def retention(self, now: int, jobs_days: int, samples_days: int):
        with self.lock, self.db:
            self.db.execute("DELETE FROM jobs WHERE end_ts IS NOT NULL AND end_ts < ?", (now - jobs_days * 86400,))
            self.db.execute("DELETE FROM req_parts WHERE label NOT IN (SELECT label FROM jobs) AND label NOT IN (SELECT label FROM queue)")
            for table in ("acct_samples", "pool_samples", "shares"):
                self.db.execute(f"DELETE FROM {table} WHERE ts < ?", (now - samples_days * 86400,))

    def db_bytes(self) -> int:
        return sum(p.stat().st_size for p in (self.path, Path(str(self.path) + "-wal")) if p.exists())
