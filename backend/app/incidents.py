"""Aggregates over the incident database (data panitia) for the executive view and the RCA backlog."""
from __future__ import annotations

from collections import defaultdict

import numpy as np

from .config import CUTOFF
from .timeutil import h_of

OPEN = {"NEW REGISTERED", "RCA PROCESS", "CA/PA EXECUTION", "MONITORING RESULT"}
RCA_STAGE = {"NEW REGISTERED", "RCA PROCESS"}
STATUS_ORDER = ["NEW REGISTERED", "RCA PROCESS", "CA/PA EXECUTION", "MONITORING RESULT", "RISK CLOSED", "RISK CANCELED"]


def _rank(a: np.ndarray) -> np.ndarray:
    order = a.argsort(kind="mergesort")
    r = np.empty(len(a))
    i = 0
    s = a[order]
    while i < len(a):
        j = i
        while j + 1 < len(a) and s[j + 1] == s[i]:
            j += 1
        r[order[i:j + 1]] = (i + j) / 2 + 1
        i = j + 1
    return r


def summary(incidents: list[dict]) -> dict:
    cutoff_h = h_of(CUTOFF)
    tot = sum(r["tot"] for r in incidents)
    by_fm, by_plant, by_month, by_status = defaultdict(float), defaultdict(float), defaultdict(lambda: [0.0, 0]), {}
    for r in incidents:
        by_fm[r["fm"]] += r["tot"]
        by_plant[r["plant"]] += r["tot"]
        m = by_month[r["date"][:7]]
        m[0] += r["tot"]; m[1] += 1
    for st in STATUS_ORDER:
        g = [r for r in incidents if r["status"] == st]
        by_status[st] = {"n": len(g), "loss": sum(r["tot"] for r in g)}
    score = np.array([r["score"] for r in incidents], dtype=float)
    loss = np.array([r["tot"] for r in incidents], dtype=float)
    rho = float(np.corrcoef(_rank(score), _rank(loss))[0, 1])
    rca = [r for r in incidents if r["status"] in RCA_STAGE]
    overdue = [r for r in rca if r["due_h"] is not None and r["due_h"] < cutoff_h]
    od_days = sorted((cutoff_h - r["due_h"]) / 24 for r in overdue)
    backlog = sorted(rca, key=lambda r: -r["tot"])[:15]
    return {
        "n": len(incidents), "totalLoss": tot, "downtime": sum(r["dt"] for r in incidents),
        "openLoss": sum(r["tot"] for r in incidents if r["status"] in OPEN), "openN": sum(r["status"] in OPEN for r in incidents),
        "rcaStage": len(rca), "rcaOverdue": len(overdue), "overdueMedianDays": od_days[len(od_days) // 2] if od_days else 0,
        "spearman": rho,
        "byMechanism": sorted(({"k": k, "v": v} for k, v in by_fm.items()), key=lambda x: -x["v"]),
        "byPlant": sorted(({"k": k, "v": v} for k, v in by_plant.items()), key=lambda x: -x["v"]),
        "byMonth": [{"k": k, "v": v[0], "n": v[1]} for k, v in sorted(by_month.items())],
        "byStatus": [{"k": k, **v} for k, v in by_status.items()],
        "backlog": [{"id": r["id"], "tag": r["tag"], "title": r["title"], "plant": r["plant"], "status": r["status"], "prerisk": r["prerisk"],
                     "score": r["score"], "loss": r["tot"], "overdueDays": None if r["due_h"] is None else round((cutoff_h - r["due_h"]) / 24)}
                    for r in backlog],
    }
