"""Cached read-only monitor endpoints and a bounded collection refresh."""
from __future__ import annotations


from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Literal, Optional

from .async_utils import run_in_thread

from .collector import ClusterMonitor, ClusterUnavailable, RefreshThrottled
from .config import ClusterConfig
from .models import ClusterOverview, ClusterRefreshResponse, QueueSpeedResponse, SeriesMetric, SeriesResponse, SpeedScope, SpeedWindow
from .views import overview, queue_speed, series
from .models import StartEstimatesResponse
from .probes import ProbeThrottled, ProbeUnavailable

router = APIRouter(prefix="/stats/skipjack/monitor", tags=["cluster"])
# Importing the API never starts collection or creates a DB.
monitor = ClusterMonitor(ClusterConfig(enabled=False))


async def start_monitor():
    global monitor
    try:
        config = ClusterConfig.from_env()
    except ValueError as exc:
        monitor = ClusterMonitor(ClusterConfig(enabled=False))
        monitor.error = str(exc)
        return
    monitor = ClusterMonitor(config)
    await monitor.start()


async def stop_monitor():
    await monitor.stop()


@router.get("", response_model=ClusterOverview)
async def get_cluster(user: Optional[str] = None):
    result = await run_in_thread(overview, monitor, int(monitor.clock() * 1000), user)
    if user is not None and user not in result["available_users"]:
        raise HTTPException(422, "Selected user is not in the cached tracked account associations")
    return result


@router.get("/queue-speed", response_model=QueueSpeedResponse)
async def get_queue_speed(window: SpeedWindow = "7d", scope: SpeedScope = "all", limited: Literal["include", "exclude"] = "exclude"):
    return await run_in_thread(queue_speed, monitor, window, scope, limited == "include", int(monitor.clock() * 1000))


@router.get("/series", response_model=SeriesResponse)
async def get_series(metric: SeriesMetric = "groups", window: SpeedWindow = "7d"):
    return await run_in_thread(series, monitor, metric, window, int(monitor.clock() * 1000))


@router.post("/refresh", response_model=ClusterRefreshResponse)
async def refresh_cluster():
    try:
        await monitor.refresh()
    except RefreshThrottled as e:
        raise HTTPException(429, str(e), headers={"Retry-After": "60"}) from e
    except ClusterUnavailable as e:
        raise HTTPException(503, str(e)) from e
    return {"ok": True}


def probe_selection(account: Optional[str] = None, partition: Optional[str] = None,
                    cpus_per_gpu: int = Query(8, ge=1, le=32), memory_gib_per_gpu: int = Query(64, ge=1, le=256)):
    return account, partition, cpus_per_gpu, memory_gib_per_gpu


@router.get("/start-estimates", response_model=StartEstimatesResponse)
async def get_start_estimates(selection=Depends(probe_selection)):
    try:
        return (await run_in_thread(monitor.probes.snapshot, *selection))[0]
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/start-estimates", response_model=StartEstimatesResponse)
async def probe_start_estimates(selection=Depends(probe_selection)):
    try:
        return await monitor.probes.refresh(*selection)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except ProbeUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    except ProbeThrottled as exc:
        raise HTTPException(429, str(exc), headers={"Retry-After": "60"}) from exc
