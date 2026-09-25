"""End-to-end API check against a running server (python run.py in another terminal).

Run from the backend folder:  .venv\\Scripts\\python -m tests.api_test
"""
import asyncio
import json
import time
import urllib.request
from datetime import datetime

import websockets

BASE = "http://127.0.0.1:8000"
START = datetime(2025, 10, 23)


def h_of(s: str) -> int:
    return int((datetime.fromisoformat(s) - START).total_seconds() // 3600)


def call(method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def check(cond: bool, msg: str) -> None:
    print(("OK   " if cond else "FAIL ") + msg)
    if not cond:
        check.failed += 1


check.failed = 0


async def live() -> None:
    async with websockets.connect(BASE.replace("http", "ws") + "/ws") as ws:
        first = json.loads(await ws.recv())
        check(first["type"] == "snapshot", "websocket sends a snapshot on connect")
        await ws.send(json.dumps({"type": "subscribe", "assetId": "BL-5702"}))
        call("POST", "/api/sim/control", {"action": "pauseOnAlert", "value": False})   # keep playing through alerts
        call("POST", "/api/sim/control", {"action": "speed", "value": 24})
        call("POST", "/api/sim/control", {"action": "play"})
        ticks, samples, real_flags = 0, 0, True
        t0 = time.time()
        while time.time() - t0 < 3:
            try:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=0.5))
            except asyncio.TimeoutError:
                continue
            if msg["type"] == "tick":
                ticks += 1
                if msg.get("samples"):
                    samples += len(msg["samples"]["h"])
                    real_flags &= len(msg["samples"]["real"]) == len(msg["samples"]["h"])
        call("POST", "/api/sim/control", {"action": "pause"})
        call("POST", "/api/sim/control", {"action": "pauseOnAlert", "value": True})
        check(ticks >= 8, f"live ticks arrive while playing ({ticks} in 3 s)")
        check(samples >= 24, f"subscribed asset streams hourly samples ({samples})")
        check(real_flags, "samples carry a real/DUMMY flag per hour")


def main() -> int:
    call("POST", "/api/sim/control", {"action": "reset"})      # start clean: no acks or work orders from earlier runs
    t = time.time()
    s, r = call("POST", "/api/sim/control", {"action": "seek", "value": h_of("2026-02-11T08:00")})
    check(s == 200, f"seek to 11 Feb 2026 ({time.time() - t:.1f}s)")
    st = call("GET", "/api/state")[1]
    ko = next(a for a in st["assets"] if a["id"] == "KO-3201")
    check(ko["status"] == "ALARM" and ko["prio"] == "P2", f"KO-3201 is ALARM P2 on 11 Feb ({ko['status']} {ko['prio']})")
    rca = call("GET", "/api/rca/KO-3201")[1]
    check(rca["hypotheses"][0]["id"] == "CO-H2O", f"top hypothesis for KO-3201 is water contamination ({rca['hypotheses'][0]['title']})")
    check(all(s_["date"] <= "2026-02-11" for s_ in rca["similar"]), "similar incidents are all dated before the replay time")

    al = next(a for a in st["alerts"] if a["assetId"] == "KO-3201" and a["open"])
    check(call("POST", f"/api/alerts/{al['id']}/ack", {"by": "REL-05"})[0] == 200, "acknowledge alert")
    s, wo = call("POST", f"/api/alerts/{al['id']}/workorder")
    check(s == 200, "create work order")
    check(call("PATCH", f"/api/workorders/{wo['id']}", {"status": "Dikerjakan"})[0] == 200, "update work order status")
    check(call("POST", f"/api/alerts/{al['id']}/workorder")[0] == 409, "duplicate work order is refused")

    t = time.time()
    check(call("POST", "/api/sim/control", {"action": "mode", "value": "manual"})[0] == 200, f"switch to manual mode ({time.time() - t:.1f}s)")
    s, r = call("POST", "/api/assets/KO-3201/intervene")
    check(s == 200, f"schedule manual intervention ({r.get('message')})")
    call("POST", "/api/sim/control", {"action": "step", "value": 24 * 90})
    st = call("GET", "/api/state")[1]
    los = st["kpis"]["losses"]
    check(los["scenarioEnd"] < los["realityEnd"], f"intervention lowers projected loss ({los['scenarioEnd']:.0f} vs {los['realityEnd']:.0f} k US$)")
    ko = next(a for a in st["assets"] if a["id"] == "KO-3201")
    check(ko["status"] in ("NORMAL", "PULIH"), f"KO-3201 healthy after the planned repair ({ko['status']})")

    check(call("POST", "/api/models/PU-2101B/retrain", {"hours": 336})[0] == 200, "retrain a model on recent normal data")
    check(len(call("GET", "/api/capa")[1]["capa"]) > 0, "CAPA tracker lists actions from published RCA reports")
    check(len(call("GET", "/api/models")[1]["models"]) == 5, "model registry lists the 5 competition assets")

    t = time.time()
    call("POST", "/api/sim/control", {"action": "mode", "value": "auto"})
    call("POST", "/api/sim/control", {"action": "seek", "value": 7055})
    st = call("GET", "/api/state")[1]
    check(abs(st["kpis"]["losses"]["scenarioEnd"] - 851.4) < 1, f"auto mode ends at US$851k for the 5 real cases ({time.time() - t:.1f}s)")
    hist = call("GET", "/api/assets/KO-3201/history?hours=2000")[1]
    check(hist["contrib"] is not None and hist["model"]["ready"], "history returns model state and contributions")
    check(len(hist["real"]) == len(hist["h"]) and all(c["real"] in (True, False) for c in hist["cm"]), "history marks real vs DUMMY hours and readings")
    check(sum(v is not None for v in hist["values"][0]) > 0.95 * len(hist["h"]), "hourly data covers the whole window (DUMMY fill outside the PI month)")

    call("POST", "/api/sim/control", {"action": "reset"})
    asyncio.run(live())
    call("POST", "/api/sim/control", {"action": "reset"})
    print("\nfailed:", check.failed)
    return check.failed


if __name__ == "__main__":
    raise SystemExit(main())
