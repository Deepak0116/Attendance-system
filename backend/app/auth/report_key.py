"""Read-only reporting key for tools such as Power BI.

The key can only fetch the /reports endpoints (attendance, leave, WFH, weekly/monthly summary). It never
returns precise WFH coordinates and cannot change anything. Stored in data/report_api_key.txt (or the
REPORT_API_KEY environment variable). Admins can view and rotate it from Settings.
"""
import hmac
import os
import secrets
from threading import Lock

from app import config

_lock = Lock()


def _path():
    return config.DATA_FILE.parent / "report_api_key.txt"


def from_env() -> bool:
    return bool(os.getenv("REPORT_API_KEY"))


def get_key() -> str:
    env = os.getenv("REPORT_API_KEY")
    if env:
        return env
    with _lock:
        p = _path()
        if p.exists():
            value = p.read_text(encoding="utf-8").strip()
            if value:
                return value
        return _write_new()


def _write_new() -> str:
    key = "alr_" + secrets.token_urlsafe(32)
    _path().parent.mkdir(parents=True, exist_ok=True)
    _path().write_text(key + "\n", encoding="utf-8")
    return key


def rotate() -> str:
    with _lock:
        return _write_new()


def matches(candidate: str | None) -> bool:
    return bool(candidate) and hmac.compare_digest(candidate.encode("utf-8"), get_key().encode("utf-8"))
