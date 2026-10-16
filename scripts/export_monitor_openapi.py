"""Export the detailed monitor contract without starting any collectors."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from fastapi import FastAPI
from monitor.routes import router

app = FastAPI(title="Skipjack monitor")
app.include_router(router)
path = ROOT / "frontend/src/app/monitor/openapi.json"
path.write_text(json.dumps(app.openapi(), indent=2) + "\n")
