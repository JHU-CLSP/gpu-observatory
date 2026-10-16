"""The standalone monitor's REST contract (camel case matches the rcb panels)."""
from __future__ import annotations


from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

SpeedWindow = Literal["24h", "7d", "30d"]
SpeedScope = Literal["all", "ours"]
SeriesMetric = Literal["groups", "pools"]
GpuClass = Literal["1", "2", "3-4", "5-8", "9+"]
TlBucket = Literal["1h", "4h", "12h", "24h", "long"]


class ClusterModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class BackfillProgress(ClusterModel):
    done_days: int
    total_days: int


class ClusterStatusView(ClusterModel):
    enabled: bool
    available: bool
    locked: bool
    error: Optional[str]
    last_tick_ms: Optional[int]
    last_sacct_ms: Optional[int]
    sacct_synced_to_ms: Optional[int]
    backfill: BackfillProgress
    job_rows: int
    db_bytes: int
    accounts: int


class BudgetView(ClusterModel):
    unit: Literal["billing-minutes", "GPU-hours"]
    limit: float
    used: float
    committed: float
    remaining: float


class AccountRunLoad(ClusterModel):
    gpus: int
    jobs: int


class AccountPendingLoad(AccountRunLoad):
    gpus_queue: int


class ClusterUserView(ClusterModel):
    user: str
    run_gpus: int
    pend_gpus: int
    fairshare: Optional[float]


class ClusterAccountView(ClusterModel):
    account: str
    group: str
    qos: str
    member: Optional[bool]
    users: int
    cap_gpus: Optional[int]
    user_cap_gpus: Optional[int]
    run: AccountRunLoad
    pend: AccountPendingLoad
    level_fs: Optional[float]
    level_fs_inf: bool
    user_fairshare: Optional[float]
    budget: Optional[BudgetView]
    top_users: list[ClusterUserView]
    trend: list[Optional[float]]
    trend_est: list[bool]


class ClusterGroupView(ClusterModel):
    name: str
    run_gpus: int
    pend_gpus: int
    accounts: list[ClusterAccountView]


class OurPendingJob(ClusterModel):
    job_id: str
    account: str
    user: str
    partitions: list[str]
    gpus: int
    time_limit_sec: Optional[int]
    eligible_ms: Optional[int]
    reason: str
    limited: bool
    est_start_ms: Optional[int]
    priority: Optional[int]


class ClusterLaneView(ClusterModel):
    partition: str
    hidden: bool
    tier: int


class ClusterPoolView(ClusterModel):
    pool: str
    total: int
    used: int
    idle: int
    planned: int
    down: int
    reserved: int
    pend_gpus_queue: int
    lanes: list[ClusterLaneView]
    preempted_24h: int = Field(alias="preempted24h")
    preempted_7d: int = Field(alias="preempted7d")
    preempted_ours_7d: int = Field(alias="preemptedOurs7d")


class ClusterTopAccount(ClusterModel):
    account: str
    run_gpus: int
    pend_gpus: int
    ours: bool


class ClusterOverview(ClusterModel):
    available_users: list[str]
    selected_user: Optional[str]
    status: ClusterStatusView
    groups: list[ClusterGroupView]
    pending_ours: list[OurPendingJob]
    capacity: list[ClusterPoolView]
    top_accounts: list[ClusterTopAccount]
    sample_ms: Optional[int]
    server_now_ms: int
    server_timezone: str


class PendingCellView(ClusterModel):
    n: int
    median_age_sec: Optional[int]
    oldest_age_sec: Optional[int]


class QueueSpeedRow(ClusterModel):
    partition: str
    gpu_class: GpuClass
    tl: TlBucket
    n: int
    events: int
    censored: int
    p50_sec: Optional[float]
    p90_sec: Optional[float]
    at_least_sec: float
    immediate_frac: float
    pending_now: PendingCellView


class QueueSpeedResponse(ClusterModel):
    window: SpeedWindow
    scope: SpeedScope
    include_limited: bool
    partitions: list[str]
    rows: list[QueueSpeedRow]
    generated_at_ms: int
    sacct_synced_to_ms: Optional[int]


class ClusterSeries(ClusterModel):
    name: str
    values: list[Optional[float]]


class SeriesResponse(ClusterModel):
    metric: SeriesMetric
    window: SpeedWindow
    step_sec: int
    t: list[int]
    series: list[ClusterSeries]
    totals: dict[str, int]
    estimated: list[bool]


class ClusterRefreshResponse(ClusterModel):
    ok: bool
