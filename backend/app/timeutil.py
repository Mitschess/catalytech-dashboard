"""The engine counts time in whole hours since SIM_START. These helpers convert to and from dates."""
from datetime import datetime, timedelta

from .config import SIM_START

MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]


def h_of(dt: datetime) -> int:
    return int((dt - SIM_START).total_seconds() // 3600)


def dt_of(h: int) -> datetime:
    return SIM_START + timedelta(hours=int(h))


def iso(h: int | None) -> str | None:
    return None if h is None else dt_of(h).strftime("%Y-%m-%dT%H:00")


def fmt_date(h: int | None) -> str:
    if h is None:
        return "-"
    d = dt_of(h)
    return f"{d.day} {MONTHS_ID[d.month - 1]} {d.year}"


def fmt_datetime(h: int | None) -> str:
    if h is None:
        return "-"
    return f"{fmt_date(h)} {dt_of(h).hour:02d}:00"
