"""Default tests never connect to SSH or Slurm."""
import os
import pytest

os.environ["OBSERVATORY_MONITOR_ENABLED"] = "false"


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
def monitor_environment(monkeypatch):
    for key in tuple(os.environ):
        if key.startswith("OBSERVATORY_MONITOR_"):
            monkeypatch.delenv(key)
    monkeypatch.setenv("OBSERVATORY_MONITOR_ENABLED", "false")
