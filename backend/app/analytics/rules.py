"""Rule and trend layers.

Levels: 0 normal, 1 watch (P3), 2 alarm (P2), 3 critical (P1).
"""
from __future__ import annotations

from collections import deque

import numpy as np

from ..sources.model import Signal


def quad_fit(y: np.ndarray) -> np.ndarray:
    x = np.arange(len(y), dtype=float)
    return np.polyfit(x, y, 2)


def predict_crossing(ys: list[float], last_h: int, period_h: int, trip: float, direction: int, horizon: int = 26) -> dict | None:
    """Quadratic fit on the last 8 period values, extrapolated until it crosses the trip limit."""
    if len(ys) < 8:
        return None
    yy = np.asarray(ys[-8:], dtype=float)
    if (yy[-1] - yy[0]) * direction <= 0:
        return None
    c = quad_fit(yy)
    for j in range(horizon):
        x = 8 + j
        if (np.polyval(c, x) - trip) * direction >= 0:
            return {"h": last_h + (j + 1) * period_h, "coef": [float(v) for v in c], "last_h": last_h, "period_h": period_h}
    return None


def sev_of(v: float, base: float, s: Signal) -> float:
    if s.trip is None or s.trip == base:
        return 0.0
    x = float((v - base) / (s.trip - base))
    return 0.0 if x < 0 else 1.0 if x > 1 else x


class CMLayer:
    """Weekly condition monitoring: baseline from the first 4 readings, drift, alarm/trip limits and trend."""

    def __init__(self, signals: list[Signal]):
        self.s = signals
        self.readings: list[np.ndarray] = []
        self.base: np.ndarray | None = None
        self.reset_segment()

    def reset_segment(self) -> None:
        self.seg: list[list[float]] = [[] for _ in self.s]
        self.streak = 0
        self.level = 0
        self.last: dict | None = None

    def update(self, h: int, v: np.ndarray) -> dict:
        self.readings.append(v)
        if self.base is None:
            if len(self.readings) >= 4:
                self.base = np.mean(np.vstack(self.readings[:4]), axis=0)
            else:
                self.last = {"h": h, "v": v, "level": 0, "health": 100, "sev": [0.0] * len(self.s), "preds": [], "reason": None}
                return self.last
        sev, rel, drift, alarm, preds = [], [], [], [], []
        trip_hit = False
        for k, s in enumerate(self.s):
            b = self.base[k]
            self.seg[k].append(float(v[k]))
            sv = sev_of(v[k], b, s); sev.append(sv)
            rl = (v[k] - b) * s.dir / abs(b) if b else 0.0
            rel.append(rl); drift.append(rl > 0.10)
            alarm.append((v[k] - s.alarm) * s.dir >= 0)
            trip_hit |= (v[k] - s.trip) * s.dir >= 0
            if sv >= 0.10:
                p = predict_crossing(self.seg[k], h, 168, s.trip, s.dir)
                if p:
                    preds.append({"k": k, **p})
        self.streak = self.streak + 1 if any(drift) else 0
        preds.sort(key=lambda p: p["h"])
        pred = preds[0] if preds else None
        days = (pred["h"] - h) / 24 if pred else None
        if trip_hit or (days is not None and days <= 14):
            k = int(np.argmax(sev)) if trip_hit else pred["k"]
            level, reason = 3, {"type": "trip" if trip_hit else "pred", "k": k}
        elif any(alarm) or (days is not None and days <= 45):
            if any(alarm):
                k = max((i for i in range(len(sev)) if alarm[i]), key=lambda i: sev[i])
                level, reason = 2, {"type": "alarm", "k": k}
            else:
                level, reason = 2, {"type": "pred", "k": pred["k"]}
        elif self.streak >= 2:
            k = max((i for i in range(len(rel)) if drift[i]), key=lambda i: rel[i])
            level, reason = 1, {"type": "drift", "k": k}
        else:
            level, reason = 0, None
        self.level = level
        self.last = {"h": h, "v": v, "level": level, "reason": reason, "sev": sev, "rel": rel, "preds": preds, "pred": pred,
                     "health": int(round(100 * (1 - max(sev))))}
        return self.last


class HourlyRuleLayer:
    """Limits, drift and daily-trend checks on hourly signals that have alarm/trip limits (none of the competition PI tags has them yet).

    Alarm/trip limits are checked on the raw 6-hour mean, exactly as an operator sees them.
    Drift and trend are judged on a process indicator: load-dependent signals can be normalised
    (e.g. exchanger dP / flow^2) and some signals are excluded from trending (motor ampere follows load).
    Work is split in two: begin_block() precomputes rolling means for a block of hours with numpy,
    row() then applies the sequential logic hour by hour.
    """

    def __init__(self, signals: list[Signal]):
        self.s = signals
        self.idx = [i for i, s in enumerate(signals) if s.trip is not None]
        keys = {s.key: i for i, s in enumerate(signals)}
        self.norm = {i: (keys[s.norm_by], s.norm_pow) for i, s in enumerate(signals) if s.norm_by in keys}
        self.ia = np.array(self.idx, dtype=int)
        self.al = np.array([signals[i].alarm for i in self.idx], dtype=float)
        self.tr = np.array([signals[i].trip for i in self.idx], dtype=float)
        self.dr = np.array([signals[i].dir for i in self.idx], dtype=float)
        self.base_buf: list[np.ndarray] = []
        self.base: np.ndarray | None = None
        self.reset_segment()

    def reset_segment(self) -> None:
        n = len(self.s)
        self.win_raw = np.zeros((0, n))
        self.win_ind = np.zeros((0, n))
        self.day_sum = np.zeros(n)
        self.day_n = 0
        self.daily: list[np.ndarray] = []
        self.preds: list[dict] = []
        self.drift_hours = 0
        self.alarm_hours = 0
        self.level = 0
        self.last: dict | None = None
        self._blk: dict | None = None

    def _indicator(self, X: np.ndarray) -> np.ndarray:
        ind = X.copy()
        for k, (j, p) in self.norm.items():
            ind[:, k] = X[:, k] / np.maximum((X[:, j] / self.base[j]) ** p, 1e-6)
        return ind

    def _update_preds(self, h: int, sev_row: np.ndarray) -> None:
        self.preds = []
        if len(self.daily) < 8:
            return
        last = np.vstack(self.daily[-8:])
        for n_, k in enumerate(self.idx):
            s = self.s[k]
            if not s.trend or sev_row[n_] < 0.10:
                continue
            d = np.diff(last[:, k]) * s.dir
            if (d > 0).sum() < 6:          # require a consistent worsening trend, not a one-off step
                continue
            p = predict_crossing(list(last[:, k]), h, 24, s.trip, s.dir, horizon=60)
            if p:
                self.preds.append({"k": k, **p})
        self.preds.sort(key=lambda p: p["h"])

    def begin_block(self, n_rows: int, X: np.ndarray, valid: np.ndarray) -> None:
        self._blk = None
        if not self.idx:
            return
        rows = np.nonzero(valid)[0]
        if self.base is None:
            need = 168 - len(self.base_buf)
            take = rows[:need]
            self.base_buf.extend(X[take])
            if len(self.base_buf) < 168:
                return
            self.base = np.mean(np.vstack(self.base_buf), axis=0)
            self.base_buf = []
            rows = rows[need:]
        if not len(rows):
            return
        Xa = X[rows]
        Ia = self._indicator(Xa)
        m = len(self.win_raw)
        full_r, full_i = np.vstack([self.win_raw, Xa]), np.vstack([self.win_ind, Ia])
        z = np.zeros((1, Xa.shape[1]))
        cs_r, cs_i = np.vstack([z, np.cumsum(full_r, axis=0)]), np.vstack([z, np.cumsum(full_i, axis=0)])
        end = np.arange(m + 1, m + len(Xa) + 1)
        st = np.maximum(end - 6, 0)
        cnt = (end - st)[:, None]
        sm, si = (cs_r[end] - cs_r[st]) / cnt, (cs_i[end] - cs_i[st]) / cnt
        self.win_raw, self.win_ind = full_r[-5:], full_i[-5:]
        b = self.base[self.ia]
        span = self.tr - b
        sev = np.clip((si[:, self.ia] - b) / np.where(span == 0, np.inf, span), 0, 1)
        rel = (si[:, self.ia] - b) * self.dr / np.where(b == 0, np.inf, np.abs(b))
        alarm = (sm[:, self.ia] - self.al) * self.dr >= 0
        pos = np.full(n_rows, -1)
        pos[rows] = np.arange(len(rows))
        self._blk = {"pos": pos, "sm": sm, "si": si, "ind": Ia, "sev": sev, "rel": rel, "alarm": alarm,
                     "trip": ((sm[:, self.ia] - self.tr) * self.dr >= 0).any(axis=1), "rel_any": (rel > 0.10).any(axis=1),
                     "alarm_any": alarm.any(axis=1), "health": np.rint(100 * (1 - sev.max(axis=1))).astype(int)}

    def row(self, i: int, h: int) -> dict | None:
        b = self._blk
        if b is None or b["pos"][i] < 0:
            return None
        j = int(b["pos"][i])
        self.day_sum += b["ind"][j]
        self.day_n += 1
        if (h + 1) % 24 == 0:
            self.daily.append(self.day_sum / self.day_n)
            self.day_sum = np.zeros(len(self.s))
            self.day_n = 0
            self._update_preds(h, b["sev"][j])
        self.drift_hours = self.drift_hours + 1 if b["rel_any"][j] else 0
        self.alarm_hours = self.alarm_hours + 1 if b["alarm_any"][j] else 0
        pred = next((p for p in self.preds if p["h"] > h), None)
        days = (pred["h"] - h) / 24 if pred else None
        trip = bool(b["trip"][j])
        if trip or (days is not None and days <= 14):
            k = self.idx[int(np.argmax(b["sev"][j]))] if trip else pred["k"]
            level, reason = 3, {"type": "trip" if trip else "pred", "k": k}
        elif self.alarm_hours >= 3 or (days is not None and days <= 45):
            if self.alarm_hours >= 3:
                k = self.idx[int(np.argmax(np.where(b["alarm"][j], b["sev"][j], -1)))]
                level, reason = 2, {"type": "alarm", "k": k}
            else:
                level, reason = 2, {"type": "pred", "k": pred["k"]}
        elif self.drift_hours >= 24:
            level, reason = 1, {"type": "drift", "k": self.idx[int(np.argmax(b["rel"][j]))]}
        else:
            level, reason = 0, None
        self.level = level
        self.last = {"h": h, "level": level, "reason": reason, "sm": b["sm"][j], "si": b["si"][j], "pred": pred,
                     "preds": [p for p in self.preds if p["h"] > h], "health": int(b["health"][j])}
        return self.last


class QualityLayer:
    """Data validation: a sensor that repeats the exact same value for 6 hours is treated as stuck (flatline)."""

    def __init__(self, n: int):
        self.prev: np.ndarray | None = None
        self.same = np.zeros(n, dtype=int)
        self.active: set[int] = set()

    def update(self, x: np.ndarray) -> tuple[list[int], list[int]]:
        started, ended = [], []
        if self.prev is not None:
            eq = np.abs(x - self.prev) < 1e-9
            self.same = np.where(eq, self.same + 1, 0)
            if self.active or eq.any():
                for k in np.nonzero(self.same >= 5)[0].tolist():
                    if k not in self.active:
                        self.active.add(k); started.append(k)
                for k in list(self.active):
                    if self.same[k] == 0:
                        self.active.discard(k); ended.append(k)
        self.prev = x
        return started, ended
