"""Smoke test: replay the full timeline in every mode and check what the engine detected.

Checks:
- every asset has hourly data over the whole timeline (real window + labelled DUMMY fill);
- the DUMMY fill never raises an alert on its own (it only shows healthy running);
- each of the five real trips gets an early warning, and the automatic scenario lowers the loss.

Run from the backend folder:  .venv\\Scripts\\python -m tests.smoke_test
"""
import sys
import tempfile
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import incidents as incident_stats  # noqa: E402
from app.config import N_HOURS  # noqa: E402
from app.engine import PlantEngine  # noqa: E402
from app.sources.competition import load_incidents, load_real_assets  # noqa: E402
from app.store import Store  # noqa: E402
from app.timeutil import fmt_datetime  # noqa: E402

ALERTS = ("WATCH", "ALARM", "CRITICAL")


def main() -> int:
    t0 = time.time()
    inc = load_incidents()
    assets = load_real_assets(inc)
    print(f"loaded {len(inc)} incidents, {len(assets)} assets in {time.time() - t0:.1f}s")
    s = incident_stats.summary(inc)
    print(f"incident summary: loss {s['totalLoss']:.0f}k, spearman {s['spearman']:.3f}, overdue {s['rcaOverdue']}/{s['rcaStage']}")
    store = Store(Path(tempfile.mkdtemp()) / "t.db")
    failures = 0

    def fail(msg: str) -> None:
        nonlocal failures
        failures += 1
        print("    !! " + msg)

    losses = {}
    for mode in ("reality", "auto"):
        eng = PlantEngine(assets, store)
        eng.mode = mode
        eng.reset()
        t1 = time.time()
        eng.advance(N_HOURS - 1, pause=False)
        print(f"\n=== mode {mode}: full replay {time.time() - t1:.1f}s, {len(eng.events)} events")
        per = defaultdict(list)
        for e in eng.events:
            per[e["assetId"]].append(e)
        for a in assets:
            m = eng.monitors[a.id]
            running = np.isin(m.code, (0, 1, 2, 3, 6))           # hours the asset was running
            has_data = ~np.isnan(m.hv).any(axis=1)
            real_h = int(m.real.sum())
            print(f"  {a.id:9s} data {int((has_data & running).sum())}/{int(running.sum())} running hours, "
                  f"{real_h} real PI hours, model trained on {PlantEngine.real_share(m) * 100:.0f}% real hours")
            if (running & ~has_data).sum() > 0:
                fail(f"{a.id}: {(running & ~has_data).sum()} running hours without data")
            evs = [e for e in per[a.id] if e["type"] != "MODEL"]
            for e in evs:
                if e["type"] in ALERTS + ("TRIP", "MAINT"):
                    tag = "real" if m.real[e["h"]] else "DUMMY"
                    print(f"      {e['type']:8s} {fmt_datetime(e['h'])} [{e['layer'] or '-'}; jam {tag}] {e['text'][:95]}")
            # The fill is healthy by construction: an AI alert on a DUMMY hour, or a condition-monitoring alert whose
            # latest weekly reading is DUMMY, is a false alarm.
            for e in evs:
                if e["type"] not in ALERTS:
                    continue
                j = int(np.searchsorted(a.cm_h, e["h"], side="right")) - 1
                cm_dummy = e["layer"] == "Condition monitoring" and (j < 0 or not a.cm_real[j])
                if (e["layer"] == "AI (MSPC)" and not m.real[e["h"]]) or cm_dummy:
                    fail(f"{a.id}: alert caused by DUMMY fill at {fmt_datetime(e['h'])} ({e['layer']})")
            if mode == "reality":
                trip = next((e for e in evs if e["type"] == "TRIP"), None)
                warn = next((e for e in evs if e["type"] in ALERTS), None)
                if not trip:
                    fail(f"{a.id}: the real trip did not happen in reality mode")
                elif not warn or warn["h"] >= trip["h"]:
                    fail(f"{a.id}: no warning before the trip")
                else:
                    print(f"    first warning {(trip['h'] - warn['h']) / 24:.0f} days before the trip")
        k = eng.kpis([eng.alert_view(al, {}, {}) for al in eng.alerts.values()])
        losses[mode] = k["losses"]
        print("  losses:", {kk: round(vv, 1) for kk, vv in k["losses"].items()})
    if not losses["auto"]["scenarioEnd"] < losses["reality"]["realityEnd"]:
        fail("automatic scenario does not lower the loss")
    print("\nFAILURES:", failures)
    return failures


if __name__ == "__main__":
    raise SystemExit(main())
