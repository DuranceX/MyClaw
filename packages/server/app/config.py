from __future__ import annotations

import os
from pathlib import Path
from typing import List


APP_DIR = Path(__file__).resolve().parent
SERVER_DIR = APP_DIR.parent
PROJECT_ROOT = SERVER_DIR.parent.parent
SKILLS_DIR = PROJECT_ROOT / ".skills"

DEFAULT_WEB_ORIGIN = "http://127.0.0.1:3000"
DEFAULT_SERVER_ENV_PATH = SERVER_DIR / ".env"
DEFAULT_WEB_ENV_PATH = PROJECT_ROOT / "packages" / "web" / ".env.local"


def _load_env_file(path: Path, *, override: bool = False) -> None:
    """Load simple KEY=VALUE pairs into process env."""
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'\"")
        if key and (override or key not in os.environ):
            os.environ[key] = value


def load_env_files() -> None:
    """Load shared env from web first, then allow server-local overrides."""
    _load_env_file(DEFAULT_WEB_ENV_PATH)
    _load_env_file(DEFAULT_SERVER_ENV_PATH, override=True)


load_env_files()


def get_allowed_origins() -> List[str]:
    value = os.getenv("WEB_ORIGIN", DEFAULT_WEB_ORIGIN)
    return [origin.strip() for origin in value.split(",") if origin.strip()]
