"""Catalytech SIGAP API: REST + WebSocket live feed + simulator loop."""
from __future__ import annotations

import asyncio
import json
import math
from contextlib import asynccontextmanager
from datetime import datetime

import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import incidents as incident_stats
from . import llm, rca
from .config import (AUTOPLAY, DB_PATH, DEFAULT_START, FRONTEND_DIST, N_HOURS, SIM_START, SLA_HOURS, SPEEDS, TICK_SECONDS)
from .engine import PRIO, PlantEngine
from .sources.competition import load_incidents, load_real_assets
from .store import Store
from .timeutil import fmt_datetime, h_of, iso


def clean(o):
    """Make engine output JSON-safe (numpy types, NaN)."""
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, np.ndarray):
        return clean(o.tolist())
    if isinstance(o, (float, np.floating)):
        f = float(o)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    return o


class _State:
    engine: PlantEngine
    store: Store
    incidents: list[dict]
    inc_summary: dict
    lock: asyncio.Lock
    clients: dict


S = _State()


def tick_payload(res: dict | None, snap: dict, sub: str | None) -> dict:
    p = {"type": "tick", **{k: v for k, v in snap.items() if k != "events"}, "newEvents": res["events"] if res else [],
         "paused": res["paused"] if res else None, "samples": None}
    if res and sub and sub in S.engine.monitors and res["to"] >= res["from"]:
        m = S.engine.monitors[sub]
        sl = slice(res["from"], res["to"] + 1)
        p["samples"] = {"assetId": sub, "h": list(range(res["from"], res["to"] + 1)),
                        "values": [m.hv[sl, k] for k in range(m.hv.shape[1])], "t2": m.t2[sl], "spe": m.spe[sl],
                        "ratio": m.ratio[sl], "code": m.code[sl], "health": m.health[sl], "real": m.real[sl].astype(int)}
    return clean(p)


async def broadcast(res: dict | None = None, kind: str = "tick") -> None:
    if not S.clients:
        return
    snap = S.engine.snapshot(events_limit=0 if kind == "tick" else 150)
    for ws, sub in list(S.clients.items()):
        try:
            if kind == "tick":
                await ws.send_text(json.dumps(tick_payload(res, snap, sub)))
            else:
                await ws.send_text(json.dumps(clean({"type": "snapshot", **snap})))
        except Exception:
            S.clients.pop(ws, None)


async def sim_loop() -> None:
    acc = 0.0
    while True:
        await asyncio.sleep(TICK_SECONDS)
        eng = S.engine
        if not eng.running or eng.now >= N_HOURS - 1:
            acc = 0.0
            continue
        acc += eng.speed * TICK_SECONDS
        n = int(acc)
        if n < 1:
            continue
        acc -= n
        async with S.lock:
            res = eng.advance(eng.now + n)
            if res["paused"] is not None or eng.now >= N_HOURS - 1:
                eng.running = False
                acc = 0.0
        await broadcast(res)


@asynccontextmanager
async def lifespan(app: FastAPI):
    S.lock = asyncio.Lock()
    S.clients = {}
    S.incidents = load_incidents()
    S.inc_summary = incident_stats.summary(S.incidents)
    assets = load_real_assets(S.incidents)
    S.store = Store(DB_PATH)
    S.store.clear()
    S.engine = PlantEngine(assets, S.store)
    S.engine.advance(h_of(DEFAULT_START), pause=False)
    S.engine.running = AUTOPLAY
    await llm.probe()
    task = asyncio.create_task(sim_loop())
    yield
    task.cancel()


app = FastAPI(title="Catalytech SIGAP API", version="1.0", lifespan=lifespan)


# ------------------------------------------------------------------ read endpoints
@app.get("/api/meta")
def meta():
    return clean({"simStart": SIM_START.isoformat(), "nHours": N_HOURS, "speeds": SPEEDS, "defaultStart": h_of(DEFAULT_START),
                  "slaHours": SLA_HOURS, "assets": [a.meta() for a in S.engine.assets], "llm": llm.status(), "incidents": S.inc_summary})


@app.get("/api/state")
async def state():
    async with S.lock:
        return JSONResponse(clean(S.engine.snapshot()))


@app.get("/api/assets/{aid}/history")
async def history(aid: str, hours: int = 168):
    if aid not in S.engine.by_id:
        raise HTTPException(404, "Aset tidak ditemukan")
    async with S.lock:
        return JSONResponse(clean(S.engine.asset_history(aid, max(24, min(hours, N_HOURS)))))


@app.get("/api/alerts")
async def alerts():
    async with S.lock:
        snap = S.engine.snapshot(events_limit=0)
        return JSONResponse(clean({"now": snap["now"], "alerts": [S.engine.alert_view(al, S.store.acks(), {w["alertId"]: w for w in S.store.workorders()})
                                                                 for al in S.engine.alerts.values()],
                                   "workorders": S.store.workorders(), "kpis": snap["kpis"]}))


@app.get("/api/capa")
async def capa():
    now = S.engine.now
    rows = []
    for a in S.engine.assets:
        if a.rca is None or a.rca["date_rep_h"] > now:
            continue
        for c in a.rca["capa"]:
            due = h_of(datetime.strptime(c["date"], "%d-%b-%Y"))
            closed = c["status"] == "Closed" and now >= due
            state = "Closed" if closed else ("Terlambat" if now > due else "Dalam jadwal")
            rows.append({"assetId": a.id, "ar": a.rca["ar"], **c, "dueH": due, "state": state, "days": round(abs(now - due) / 24)})
    return clean({"now": now, "capa": rows})


@app.get("/api/models")
async def models():
    async with S.lock:
        out = []
        for m in S.engine.monitors.values():
            a = m.a
            tr = m.model.trained_range
            anomalies = int(np.nansum(m.ratio[: S.engine.now + 1] > 1)) if m.model.ready else 0
            scored = int(np.sum(~np.isnan(m.ratio[: S.engine.now + 1])))
            out.append({"assetId": a.id, "source": a.source, "ready": m.model.ready, "progress": m.model.progress, "nTrain": m.model.n_train,
                        "info": m.model.info, "trainedRange": tr, "realShare": S.engine.real_share(m), "scored": scored, "anomalyHours": anomalies,
                        "lastRatio": None if not m.mspc_last else m.mspc_last["ratio"], "keys": m.model.keys})
        return JSONResponse(clean({"now": S.engine.now, "models": out}))


@app.get("/api/rca/{aid}")
async def rca_view(aid: str):
    if aid not in S.engine.by_id:
        raise HTTPException(404, "Aset tidak ditemukan")
    async with S.lock:
        eng = S.engine
        hyps = rca.hypotheses(eng, aid)
        m = eng.monitors[aid]
        return JSONResponse(clean({"assetId": aid, "now": eng.now, "status": m.status, "condition": rca.condition(eng, aid)["rows"],
                                   "hypotheses": hyps, "similar": rca.similar(eng, S.incidents, aid, hyps[0] if hyps else None),
                                   "lessons": rca.lessons(eng, aid, hyps[0] if hyps else None), "draft": rca.draft(eng, aid, hyps),
                                   "dq": [m.a.hourly[k].name for k in m.dq_active], "llm": llm.status()}))


# ------------------------------------------------------------------ actions
class ControlBody(BaseModel):
    action: str
    value: float | str | bool | None = None


@app.post("/api/sim/control")
async def control(body: ControlBody):
    eng = S.engine
    async with S.lock:
        a, v = body.action, body.value
        if a == "play":
            eng.running = eng.now < N_HOURS - 1
        elif a == "pause":
            eng.running = False
        elif a == "speed" and v is not None and int(float(v)) in SPEEDS:
            eng.speed = int(float(v))
        elif a == "step" and v is not None:
            eng.running = False
            res = eng.advance(eng.now + max(1, int(float(v))), pause=False)
        elif a == "seek" and v is not None:
            was_running = eng.running
            eng.seek(int(float(v)))
            eng.running = was_running and eng.now < N_HOURS - 1   # keep playing after a jump, like a media player
        elif a == "mode" and v in ("reality", "auto", "manual"):
            eng.set_mode(str(v))
        elif a == "pauseOnAlert":
            eng.pause_on_alert = bool(v)
        elif a == "reset":
            S.store.clear()
            eng.mode = "reality"
            eng.seek(h_of(DEFAULT_START))
        else:
            raise HTTPException(400, "Aksi tidak dikenal")
    await broadcast(kind="snapshot")
    return {"ok": True, "now": eng.now}


class AckBody(BaseModel):
    by: str = "Engineer"


@app.post("/api/alerts/{alert_id}/ack")
async def ack(alert_id: str, body: AckBody):
    if alert_id not in S.engine.alerts:
        raise HTTPException(404, "Alert tidak ditemukan")
    S.store.ack(alert_id, S.engine.now, body.by[:40] or "Engineer")
    await broadcast(kind="snapshot")
    return {"ok": True}


@app.post("/api/alerts/{alert_id}/workorder")
async def workorder(alert_id: str):
    al = S.engine.alerts.get(alert_id)
    if not al:
        raise HTTPException(404, "Alert tidak ditemukan")
    if any(w["alertId"] == alert_id for w in S.store.workorders()):
        raise HTTPException(409, "Work order untuk alert ini sudah ada")
    a = S.engine.by_id[al["assetId"]]
    lvl = al["level"]
    wo_id = S.store.create_wo(alert_id=alert_id, asset_id=a.id, title=f"{a.id} {a.short}: {al['reason'][:160]}", prio=PRIO[lvl], owner=a.pic,
                              created_h=S.engine.now, due_h=S.engine.now + SLA_HOURS.get(lvl, 168), source=a.source)
    await broadcast(kind="snapshot")
    return {"ok": True, "id": wo_id}


class WOBody(BaseModel):
    status: str


@app.patch("/api/workorders/{wo_id}")
async def update_wo(wo_id: int, body: WOBody):
    if body.status not in ("Open", "Dikerjakan", "Selesai"):
        raise HTTPException(400, "Status tidak dikenal")
    if not S.store.update_wo(wo_id, body.status, S.engine.now):
        raise HTTPException(404, "Work order tidak ditemukan")
    await broadcast(kind="snapshot")
    return {"ok": True}


@app.post("/api/assets/{aid}/intervene")
async def intervene(aid: str):
    if aid not in S.engine.by_id:
        raise HTTPException(404, "Aset tidak ditemukan")
    async with S.lock:
        res = S.engine.request_intervention(aid)
    if not res["ok"]:
        raise HTTPException(409, res["message"])
    await broadcast(kind="snapshot")
    return res


class RetrainBody(BaseModel):
    hours: int = 336


@app.post("/api/models/{aid}/retrain")
async def retrain(aid: str, body: RetrainBody):
    if aid not in S.engine.by_id:
        raise HTTPException(404, "Aset tidak ditemukan")
    async with S.lock:
        eng = S.engine
        m = eng.monitors[aid]
        h1 = eng.now
        h0 = max(0, h1 - body.hours + 1)
        X = m.hv[h0:h1 + 1][:, m.a.mspc_idx].astype(float)
        codes = m.code[h0:h1 + 1]
        ok = ~np.isnan(X).any(axis=1) & np.isin(codes, (0, 6))
        if ok.sum() < 48:
            raise HTTPException(409, "Data normal terbaru kurang dari 48 jam. Latih ulang setelah aset beroperasi normal.")
        m.model.fit(X[ok], (h0, h1))
        m.c1 = m.c5 = 0
        i = m.model.info
        eng.event(h1, m.a, "MODEL", "-", f"Model AI dilatih ulang dari {i['n']} jam data normal terbaru ({i['k']} komponen).")
    await broadcast(kind="snapshot")
    return clean({"ok": True, "info": m.model.info})


class AskBody(BaseModel):
    question: str | None = None
    history: list[dict] = []


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj)}\n\n"


@app.post("/api/rca/{aid}/ask")
async def ask(aid: str, body: AskBody):
    if aid not in S.engine.by_id:
        raise HTTPException(404, "Aset tidak ditemukan")
    await llm.probe()
    st = llm.status()
    if not st["available"]:
        raise HTTPException(503, st["detail"] or "Asisten AI belum aktif.")
    async with S.lock:
        ctx = rca.llm_context(S.engine, S.incidents, aid)
    msgs = [{"role": "user", "content": f"KONTEKS DARI DASHBOARD:\n{ctx}\n\nTUGAS: {rca.TASK}"}]
    for t in body.history[-8:]:
        if t.get("role") in ("user", "assistant") and str(t.get("content", "")).strip():
            msgs.append({"role": t["role"], "content": str(t["content"])[:6000]})
    if body.question and body.question.strip():
        msgs.append({"role": "user", "content": body.question.strip()[:2000]})

    async def gen():
        try:
            async for chunk in llm.stream_answer(rca.RULES, msgs):
                yield _sse({"text": chunk})
            yield _sse({"done": True})
        except llm.LLMError as e:
            yield _sse({"error": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


# ------------------------------------------------------------------ live feed
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    S.clients[ws] = None
    try:
        async with S.lock:
            snap = S.engine.snapshot()
        await ws.send_text(json.dumps(clean({"type": "snapshot", **snap})))
        while True:
            msg = json.loads(await ws.receive_text())
            if msg.get("type") == "subscribe":
                S.clients[ws] = msg.get("assetId")
    except (WebSocketDisconnect, RuntimeError, json.JSONDecodeError):
        pass
    finally:
        S.clients.pop(ws, None)


# ------------------------------------------------------------------ frontend (built with `npm run build`)
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = FRONTEND_DIST / path
        if path and f.is_file():
            return FileResponse(f)
        return FileResponse(FRONTEND_DIST / "index.html")
