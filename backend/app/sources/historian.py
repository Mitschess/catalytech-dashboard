"""Simulated plant historian.

Stands in for a PI Web API / OPC UA connector: for a given asset and hour it returns what the
historian would hold. Swapping this class for a real connector is the only change needed to run
on live plant data. Interventions change what the plant produces from that hour on (a repaired
asset stops degrading), which is how the "what if we act" scenarios are simulated.

Every value comes with a flag saying whether it is real competition data or the labelled DUMMY fill
used outside the real data windows (see sources/competition.py).
"""
from __future__ import annotations

import numpy as np

from .model import Asset


class SimulatedHistorian:
    def __init__(self, assets: list[Asset]):
        self.assets = {a.id: a for a in assets}
        self.iv: dict[str, int] = {}

    def reset(self) -> None:
        self.iv.clear()

    def intervene(self, aid: str, h: int) -> bool:
        a = self.assets[aid]
        if aid in self.iv:
            return False
        if a.trip_start is not None and h >= a.trip_start:
            return False
        self.iv[aid] = h
        return True

    def intervened(self, aid: str) -> bool:
        a, iv = self.assets[aid], self.iv.get(aid)
        return iv is not None and (a.trip_start is None or iv < a.trip_start)

    def repair_h(self, aid: str) -> int | None:
        a = self.assets[aid]
        if self.intervened(aid):
            return self.iv[aid] + a.planned_h
        return a.trip_end

    def state(self, aid: str, h: int) -> str:
        """'run', 'trip' (unplanned outage) or 'maint' (planned intervention)."""
        a, iv = self.assets[aid], self.iv.get(aid)
        if iv is not None and iv <= h < iv + a.planned_h:
            return "maint"
        if a.trip_start is not None and not self.intervened(aid) and a.trip_start <= h < a.trip_end:
            return "trip"
        return "run"

    def state_block(self, aid: str, h0: int, h1: int) -> np.ndarray:
        """Vector of states for hours h0..h1: 0 run, 1 trip, 2 planned intervention."""
        a, iv = self.assets[aid], self.iv.get(aid)
        H = np.arange(h0, h1 + 1)
        out = np.zeros(len(H), dtype=np.int8)
        if a.trip_start is not None and not self.intervened(aid):
            out[(H >= a.trip_start) & (H < a.trip_end)] = 1
        if iv is not None:
            out[(H >= iv) & (H < iv + a.planned_h)] = 2
        return out

    def hourly_block(self, aid: str, h0: int, h1: int) -> tuple[np.ndarray, np.ndarray]:
        """Hourly values for h0..h1 as an (n, k) array (NaN rows = no data) and a bool mask of rows that are
        real competition data. The caller asks for a range where the asset is running (no outage inside).

        Inside the real PI window the real data is used, unless a planned intervention has already repaired
        the asset: from then on the asset runs healthy, which is what the DUMMY fill represents."""
        a = self.assets[aid]
        H = np.arange(h0, h1 + 1)
        rows = a.hr_fill[h0:h1 + 1].copy()
        i = H - a.hr_t0
        real = (i >= 0) & (i < len(a.hr_values))
        if self.intervened(aid):
            real &= H < self.iv[aid] + a.planned_h
        rows[real] = a.hr_values[i[real]]
        stopped = np.zeros(len(H), bool)
        stopped[real] = ~a.hr_run[i[real]]
        rows[stopped] = np.nan
        return rows, real

    def weekly_block(self, aid: str, h0: int, h1: int) -> dict[int, tuple[np.ndarray, bool]]:
        """Weekly condition-monitoring readings in h0..h1: {hour: (values, is_real)}."""
        a = self.assets[aid]
        if a.cm_h is None:
            return {}
        out = {}
        for j in np.nonzero((a.cm_h >= h0) & (a.cm_h <= h1))[0]:
            h = int(a.cm_h[j])
            if a.cm_real[j] and self.intervened(aid) and h > self.iv[aid]:
                # After a planned repair the real readings of the degraded period are replaced by the
                # real post-repair readings (cycled): the asset no longer degrades.
                k = int(np.sum(a.cm_real & (a.cm_h > self.iv[aid]) & (a.cm_h <= h))) - 1
                out[h] = (a.cm_post[k % len(a.cm_post)].copy(), True)
            else:
                out[h] = (a.cm_values[j].copy(), bool(a.cm_real[j]))
        return out
