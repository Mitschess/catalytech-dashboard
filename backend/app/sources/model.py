"""Shared data structures for assets and their signals."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class Signal:
    key: str
    name: str
    unit: str
    alarm: float | None = None
    trip: float | None = None
    dir: int = 1            # +1: higher is worse, -1: lower is worse
    mspc: bool = True       # included in the multivariate anomaly model
    trend: bool = True      # used for trend prediction (off for load-dependent signals such as motor ampere)
    norm_by: str | None = None   # judge drift/trend on value / (norm_by / baseline)^norm_pow, e.g. dP / flow²
    norm_pow: float = 2.0

    def to_dict(self) -> dict:
        return {"key": self.key, "name": self.name, "unit": self.unit, "alarm": self.alarm,
                "trip": self.trip, "dir": self.dir, "mspc": self.mspc, "normBy": self.norm_by}


@dataclass(kw_only=True)
class Asset:
    id: str
    name: str
    short: str
    eq_type: str
    type_code: str          # equipment type code used in the incident database (PU, CO, EM, HB, BL)
    cls: str
    plant_code: str
    plant: str
    disc: str
    crit: str
    pic: str
    spare: str
    source: str             # "real": the asset and its event come from the competition data
    loss_per_h: float       # k US$ per hour of unplanned downtime
    trip_hours: float
    trip_loss: float        # k US$ if the asset trips
    prod_loss: float | None
    planned_loss: float     # k US$ for a planned intervention
    planned_h: int
    planned_action: str
    hourly: list[Signal]
    weekly: list[Signal] = field(default_factory=list)
    # hourly PI data: the real 30-day window from the competition files...
    hr_t0: int | None = None
    hr_values: np.ndarray | None = None     # (n_hours, n_signals)
    hr_run: np.ndarray | None = None        # (n_hours,) bool
    # ...and a labelled DUMMY fill for the whole simulated timeline (healthy operation built from the asset's own
    # normal hours), so all assets run on one clock. Real data always takes precedence inside its window.
    hr_fill: np.ndarray | None = None       # (N_HOURS, n_signals)
    # weekly condition monitoring: real readings plus DUMMY readings before/after the real range
    cm_h: np.ndarray | None = None
    cm_values: np.ndarray | None = None
    cm_real: np.ndarray | None = None       # bool per reading
    cm_post: np.ndarray | None = None       # real readings after the repair, reused after a planned intervention
    # natural trip window (what happens if nobody acts)
    trip_start: int | None = None
    trip_end: int | None = None
    scenario: str = ""
    rca: dict | None = None
    incident: dict | None = None
    extra: dict = field(default_factory=dict)

    @property
    def mspc_idx(self) -> list[int]:
        return [i for i, s in enumerate(self.hourly) if s.mspc]

    def meta(self) -> dict:
        from ..timeutil import iso
        return {
            "id": self.id, "name": self.name, "short": self.short, "eqType": self.eq_type, "typeCode": self.type_code,
            "cls": self.cls, "plantCode": self.plant_code, "plant": self.plant, "disc": self.disc, "crit": self.crit,
            "pic": self.pic, "spare": self.spare, "source": self.source, "lossPerH": self.loss_per_h,
            "tripHours": self.trip_hours, "tripLoss": self.trip_loss, "plannedLoss": self.planned_loss,
            "plannedH": self.planned_h, "plannedAction": self.planned_action,
            "hourly": [s.to_dict() for s in self.hourly], "weekly": [s.to_dict() for s in self.weekly],
            "hourlyWindow": None if self.hr_values is None else [self.hr_t0, self.hr_t0 + len(self.hr_values) - 1],
            "weeklyWindow": None if self.cm_h is None else [int(self.cm_h[self.cm_real][0]), int(self.cm_h[self.cm_real][-1])],
            "scenario": self.scenario, "ar": (self.rca or {}).get("ar"),
            "oldPreRisk": (self.incident or {}).get("prerisk"), "oldScore": (self.incident or {}).get("score"),
            "hourlyStartIso": iso(self.hr_t0), "tripStart": self.trip_start,
        }
