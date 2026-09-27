"""Runtime settings. Every value can be overridden with an environment variable."""
import os
from datetime import datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _load_env_file(path: Path) -> None:
    """Read KEY=VALUE lines from backend/.env. Variables already set in the environment win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        if key.strip() and value:
            os.environ.setdefault(key.strip(), value)


_load_env_file(BACKEND_DIR / ".env")
SOURCE_DIR = Path(os.getenv("CATALYTECH_SOURCE_DIR", BACKEND_DIR / "data" / "source"))
DB_PATH = Path(os.getenv("CATALYTECH_DB", BACKEND_DIR / "data" / "catalytech.db"))
FRONTEND_DIST = Path(os.getenv("CATALYTECH_FRONTEND", BACKEND_DIR.parent / "frontend" / "dist"))

# Simulated clock: the replay covers the competition data window.
SIM_START = datetime(2025, 10, 23, 0)
SIM_END = datetime(2026, 8, 12, 23)
N_HOURS = int((SIM_END - SIM_START).total_seconds() // 3600) + 1
DEFAULT_START = datetime.fromisoformat(os.getenv("CATALYTECH_START", "2026-01-05T08:00"))
CUTOFF = datetime(2026, 8, 19)  # data cut-off used for RCA/CAPA overdue figures

TICK_SECONDS = 0.25                 # how often the simulator pushes data to the browser
SPEEDS = [1, 6, 24, 72, 168]        # simulated hours per real second
DEFAULT_SPEED = int(os.getenv("CATALYTECH_SPEED", "24"))
AUTOPLAY = os.getenv("CATALYTECH_AUTOPLAY", "0") == "1"

# Anomaly model (MSPC) training windows, in hours of clean running data.
MSPC_TRAIN = 336         # two weeks of clean running (DUMMY fill built from each asset's own normal days)

# SLA per priority level, in hours.
SLA_HOURS = {3: 24, 2: 168, 1: 168}

# RCA assistant. "local" talks to an OpenAI-compatible server (Ollama, LM Studio) so no data
# leaves the plant network; "claude" uses Anthropic's hosted API and needs ANTHROPIC_API_KEY.
LLM_PROVIDER = os.getenv("CATALYTECH_LLM_PROVIDER", "local").strip().lower()
_DEFAULT_MODEL = "qwen2.5:3b" if LLM_PROVIDER == "local" else "claude-opus-5"
LLM_MODEL = os.getenv("CATALYTECH_LLM_MODEL", _DEFAULT_MODEL)
LLM_BASE_URL = os.getenv("CATALYTECH_LLM_BASE_URL", "http://127.0.0.1:11434/v1").rstrip("/")
# Small local models answer slowly and ramble, so cap the answer harder than a hosted model.
LLM_MAX_TOKENS = int(os.getenv("CATALYTECH_LLM_MAX_TOKENS", "1500" if LLM_PROVIDER == "local" else "16000"))
LLM_TIMEOUT = float(os.getenv("CATALYTECH_LLM_TIMEOUT", "300"))
