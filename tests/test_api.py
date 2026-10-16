"""API compatibility and per-request user perspectives over shared cached data."""
from dataclasses import replace

import httpx
import pytest

import app as application
from monitor import routes
from monitor.commands import CommandResult
from monitor.config import ClusterConfig
from monitor.models import ClusterOverview
from monitor.views import overview
from tests.fixtures.cluster import ASSOC, SHARES, FakeSlurm, NOW
from tests.test_monitor import make_monitor


@pytest.fixture
async def monitored(tmp_path, monkeypatch):
    fake = FakeSlurm()

    async def runner(command, args):
        result = await fake(command, args)
        if command == "sacctmgr" and "qos" not in args:
            return CommandResult(0, ASSOC + "\nbvandur1_blabscify||other|jhu2|gres/gpu=3|")
        if command == "sshare":
            return CommandResult(0, SHARES + "\nbvandur1_blabscify|other|1|1|100|0.01|0.8|1||billing=0|billing=0")
        return result

    mon = make_monitor(tmp_path, runner)
    await mon.tick()
    monkeypatch.setattr(routes, "monitor", mon)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application.app), base_url="http://test") as client:
        yield client, mon, fake
    await mon.stop()


@pytest.mark.anyio
async def test_overview_user_selection_is_cached_and_request_local(monitored):
    client, mon, fake = monitored
    count = len(fake.calls)
    base = "/stats/skipjack/monitor"
    neutral = (await client.get(base)).json()
    assert neutral["selectedUser"] is None and neutral["availableUsers"] == ["other", "viewer"]
    assert neutral["groups"][0]["accounts"][0]["member"] is None
    assert neutral["groups"][0]["accounts"][0]["userFairshare"] is None
    viewer = (await client.get(base, params={"user": "viewer"})).json()
    other = (await client.get(base, params={"user": "other"})).json()
    assert viewer["groups"][0]["accounts"][0]["userFairshare"] == .165
    assert other["groups"][0]["accounts"][0]["userFairshare"] == .8
    assert other["groups"][0]["accounts"][0]["userCapGpus"] == 3
    assert other["groups"][1]["accounts"][0]["member"] is False
    assert viewer["groups"][0]["runGpus"] == other["groups"][0]["runGpus"]
    assert (await client.get(base, params={"user": "unknown"})).status_code == 422
    assert (await client.get(base)).json() == neutral
    assert len(fake.calls) == count


@pytest.mark.anyio
async def test_query_validation_history_and_throttled_refresh(monitored):
    client, mon, fake = monitored
    base = "/stats/skipjack/monitor"
    speed = await client.get(base + "/queue-speed?window=24h&scope=ours&limited=exclude")
    assert speed.status_code == 200 and speed.json()["rows"]
    assert (await client.get(base + "/series?metric=groups&window=7d")).json()["series"]
    for query in ("/queue-speed?window=bogus", "/queue-speed?scope=bogus", "/queue-speed?limited=bogus", "/series?metric=bogus"):
        assert (await client.get(base + query)).status_code == 422
    assert (await client.post(base + "/refresh")).status_code == 200
    limited = await client.post(base + "/refresh")
    assert limited.status_code == 429 and limited.headers["Retry-After"] == "60"


@pytest.mark.anyio
async def test_budget_units_are_explicit(monitored):
    _, mon, _ = monitored
    from monitor.parse import parse_shares
    for resource, expected_unit, divisor in (("billing", "billing-minutes", 1), ("gres/gpu", "GPU-hours", 60)):
        text = f"bvandur1_blabscify||100|0.1|1000|0.1||0.4|{resource}=60000|{resource}=12000|{resource}=6000"
        mon.store.add_shares(NOW + 1, parse_shares(text))
        result = ClusterOverview.model_validate(overview(mon, NOW * 1000))
        budget = result.groups[0].accounts[0].budget
        assert budget.unit == expected_unit
        assert budget.limit == 60000 / divisor
        assert budget.used == 12000 / divisor
        assert budget.committed == 6000 / divisor
        assert budget.remaining == 42000 / divisor


@pytest.mark.anyio
async def test_disabled_startup_and_invalid_config_keep_api_usable(tmp_path, monkeypatch):
    monkeypatch.setenv("OBSERVATORY_MONITOR_DB", str(tmp_path / "unused.db"))
    await routes.start_monitor()
    try:
        assert not routes.monitor.config.enabled and routes.monitor.store is None
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application.app), base_url="http://test") as client:
            response = await client.get("/stats/skipjack/monitor")
            assert response.status_code == 200 and response.json()["status"]["enabled"] is False
            assert (await client.post("/stats/skipjack/monitor/refresh")).status_code == 503
        assert not (tmp_path / "unused.db").exists()
    finally:
        await routes.stop_monitor()
    monkeypatch.setenv("OBSERVATORY_MONITOR_GROUPS", "invalid")
    await routes.start_monitor()
    assert "GROUPS" in routes.monitor.error
    await routes.stop_monitor()


@pytest.mark.anyio
async def test_existing_stats_endpoints_and_lifespan_remain_compatible(monkeypatch):
    async def fetch(server):
        return {"server": server}
    async def background():
        import asyncio
        await asyncio.Event().wait()
    monkeypatch.setattr(application, "_fetch_server", fetch)
    monkeypatch.setattr(application, "_background_refresh_loop", background)
    monkeypatch.setattr(application, "_cache", {})
    async with application.app.router.lifespan_context(application.app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application.app), base_url="http://test") as client:
            response = await client.get("/stats")
            assert response.json() == {name: {"server": name} for name in ("skipjack", "dsai", "ia1")}
            for name in ("skipjack", "dsai", "ia1"):
                assert (await client.get("/stats/" + name)).json() == {"server": name}
                assert (await client.post("/stats/" + name + "/refresh")).json() == {"server": name}
            assert (await client.post("/stats/refresh")).status_code == 200
            assert (await client.get("/stats/history")).status_code == 200
    assert not routes.monitor.available
