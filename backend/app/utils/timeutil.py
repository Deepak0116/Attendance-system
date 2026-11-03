from datetime import date, datetime, timedelta
from typing import Iterator

_override: datetime | None = None


def set_now(value: datetime | None) -> None:
    """Freeze the clock (used by tests)."""
    global _override
    _override = value


def now() -> datetime:
    return (_override or datetime.now()).replace(microsecond=0)


def today() -> date:
    return now().date()


def fmt_dt(value: datetime) -> str:
    return value.strftime("%Y-%m-%dT%H:%M:%S")


def now_str() -> str:
    return fmt_dt(now())


def parse_date(value: str) -> date:
    return date.fromisoformat(value)


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value)


def daterange(start: date, end: date) -> Iterator[date]:
    for i in range((end - start).days + 1):
        yield start + timedelta(days=i)
