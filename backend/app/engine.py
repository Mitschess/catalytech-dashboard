"""Plant engine: reads the historian, runs every analytics layer, fuses them into one status per
asset, and manages alerts, events, losses and interventions. Data is read in blocks and scored with
numpy; the status logic then runs hour by hour.

Processing is strictly causal: at hour h the engine only uses data up to h.
"""
from __future__ import annotations

import math

import numpy as np

from .analytics.mspc import MSPCModel
from .analytics.rules import CMLayer, HourlyRuleLayer, QualityLayer
from .config import DEFAULT_SPEED, MSPC_TRAIN, N_HOURS, SLA_HOURS
from .sources.historian import SimulatedHistorian
from .sources.model import Asset
from .timeutil import fmt_date, fmt_datetime, iso

NAMES = ["NORMAL", "WATCH", "ALARM", "CRITICAL"]
PRIO = {0: "-", 1: "P3", 2: "P2", 3: "P1"}
CODE = {"NODATA": -1, "NORMAL": 0, "WATCH": 1, "ALARM": 2, "CRITICAL": 3, "TRIP": 4, "MAINT": 5, "PULIH": 6}
STOPPERS = {"ALARM", "CRITICAL", "TRIP", "MAINT"}
LAYER_ORDER = {"Condition monitoring": 0, "Batas per jam": 1, "AI (MSPC)": 2}


def fv(v: float) -> str:
    a = abs(v)
    dec = 3 if a < 2 else 2 if a < 20 else 1 if a < 200 else 0
    return f"{v:,.{dec}f}".replace(",", "#").replace(".", ",").replace("#", ".")


def usd(k: float) -> str:
    if k >= 1000:
        return "US$" + f"{k / 1000:.2f}".replace(".", ",") + " jt"
    return f"US${k:.0f} rb"


def p_fail(level: int, days: float | None) -> float:
    if level >= 3:
        return 0.9
    if level == 2:
        return 0.6 if days is not None and days <= 45 else 0.4
    return 0.15 if level == 1 else 0.0


class Monitor:
    def __init__(self, a: Asset, eng: "PlantEngine"):
        self.a, self.eng = a, eng
        k = len(a.hourly)
        self.hv = np.full((N_HOURS, k), np.nan, dtype=np.float32)
        self.t2 = np.full(N_HOURS, np.nan, dtype=np.float32)
        self.spe = np.full(N_HOURS, np.nan, dtype=np.float32)
        self.ratio = np.full(N_HOURS, np.nan, dtype=np.float32)
        self.code = np.full(N_HOURS, -1, dtype=np.int8)
        self.health = np.full(N_HOURS, np.nan, dtype=np.float32)
        self.real = np.zeros(N_HOURS, dtype=bool)     # hour holds real competition data (else DUMMY fill)
        self.cm = CMLayer(a.weekly) if a.weekly else None
        self.hr = HourlyRuleLayer(a.hourly)
        self.dq = QualityLayer(k)
        self.model = MSPCModel(MSPC_TRAIN, [a.hourly[i].key for i in a.mspc_idx])
        self.cm_log: list[dict] = []
        self.phase = "run"
        self.restored_h: int | None = None
        self.episode: dict | None = None
        self.c1 = self.c5 = 0
        self.mspc_last: dict | None = None
        self.last_data_h: int | None = None
        self.last_health: float | None = None
        self.dq_active: dict[int, int] = {}
        self.status = "NODATA"

    # ------------------------------------------------------------------ a block of hours
    def advance(self, h0: int, h1: int) -> None:
        """Process hours h0..h1. The engine guarantees no intervention starts inside the block."""
        states = self.eng.hist.state_block(self.a.id, h0, h1)
        n = len(states)
        i = 0
        while i < n:
            j = i
            while j + 1 < n and states[j + 1] == states[i]:
                j += 1
            if states[i] == 0:
                self._run(h0 + i, h0 + j)
            else:
                self._outage(h0 + i, h0 + j, "trip" if states[i] == 1 else "maint")
            i = j + 1

    def _outage(self, s0: int, s1: int, kind: str) -> None:
        a, eng = self.a, self.eng
        if self.phase != kind:
            self.phase = kind
            eng.now_h = s0
            self._close_episode(s0, "trip" if kind == "trip" else "planned")
            eng.book_loss(a, s0, kind)
            if kind == "trip":
                eng.event(s0, a, "TRIP", "-", f"Trip tidak terencana: {fv(a.trip_hours)} jam downtime, kerugian {usd(a.trip_loss)}.")
            else:
                eng.event(s0, a, "MAINT", "-", f"Intervensi terencana dimulai: {a.planned_action}. Perkiraan kerugian {usd(a.planned_loss)} "
                                               f"(vs {usd(a.trip_loss)} jika trip).")
        self.status = "TRIP" if kind == "trip" else "MAINT"
        self.code[s0:s1 + 1] = CODE[self.status]

    def _dq_block(self, X: np.ndarray, valid: np.ndarray) -> tuple[np.ndarray, dict]:
        """Flatline detection. Fast path when no sample repeats exactly (the normal case)."""
        n = len(X)
        active = np.zeros(n, dtype=bool)
        events: dict[int, list] = {}
        rows = np.nonzero(valid)[0]
        if not len(rows):
            return active, events
        Xv = X[rows]
        stack = Xv if self.dq.prev is None else np.vstack([self.dq.prev[None, :], Xv])
        eq_any = len(stack) > 1 and bool((np.abs(np.diff(stack, axis=0)) < 1e-9).any())
        if not eq_any and not self.dq.active:
            self.dq.same[:] = 0
            self.dq.prev = Xv[-1].copy()
            return active, events
        for r in rows:
            started, ended = self.dq.update(X[r].copy())
            if started or ended:
                events[int(r)] = [("start", k) for k in started] + [("end", k) for k in ended]
            active[r] = bool(self.dq.active)
        return active, events

    def _mspc_block(self, H: np.ndarray, X: np.ndarray, eligible: np.ndarray) -> dict:
        model, idx = self.model, self.a.mspc_idx
        rows = np.nonzero(eligible)[0]
        out = {"fit_row": None, "pos": None}
        if not model.ready:
            need = model.n_train - len(model.buf)
            take = rows[:need]
            if len(take):
                if not model.buf:
                    model._first_h = int(H[take[0]])
                model.buf.extend(X[take][:, idx])
            if len(model.buf) < model.n_train:
                return out
            model.fit(np.vstack(model.buf), (model._first_h, int(H[take[-1]])))
            out["fit_row"] = int(take[-1])
            rows = rows[need:]
        if not len(rows):
            return out
        Z = (X[rows][:, idx] - model.mu) / model.sd
        T = Z @ model.P
        t2 = (T * T / model.lam).sum(axis=1)
        R = Z - T @ model.P.T
        spe = (R * R).sum(axis=1)
        rt2, rspe = t2 / model.lim_t2, spe / model.lim_spe
        pos = np.full(len(H), -1)
        pos[rows] = np.arange(len(rows))
        out.update(pos=pos, t2=t2, spe=spe, ratio=np.maximum(rt2, rspe), is_spe=rspe >= rt2, Z=Z, T=T, R=R)
        return out

    def _contrib(self, mb: dict, j: int) -> np.ndarray:
        return self.model.contributions({"stat": "SPE" if mb["is_spe"][j] else "T2", "z": mb["Z"][j], "t": mb["T"][j], "r": mb["R"][j]})

    def _run(self, s0: int, s1: int) -> None:
        a, eng, hist = self.a, self.eng, self.eng.hist
        if self.phase in ("trip", "maint"):
            was = self.phase
            self.phase, self.restored_h = "run", s0
            self._after_repair()
            eng.event(s0, a, "PULIH", "-", "Kembali beroperasi setelah perbaikan darurat. RCA dan CAPA dibuka." if was == "trip"
                      else "Kembali beroperasi normal. Verifikasi efektivitas tindakan selama 3 bulan dimulai.")
        n = s1 - s0 + 1
        H = np.arange(s0, s1 + 1)
        X, R = hist.hourly_block(a.id, s0, s1)
        self.real[s0:s1 + 1] = R
        valid = ~np.isnan(X).any(axis=1)
        any_valid = bool(valid.any())
        if any_valid:
            self.hv[s0:s1 + 1][valid] = X[valid]
            dq_mask, dq_events = self._dq_block(X, valid)
            self.hr.begin_block(n, X, valid)
            mb = self._mspc_block(H, X, valid & ~dq_mask)
        else:
            dq_events, mb = {}, {"fit_row": None, "pos": None}
            self.hr._blk = None
        weekly = hist.weekly_block(a.id, s0, s1) if self.cm is not None else {}
        pos = mb["pos"]
        last_scored = None
        for i in range(n):
            h = s0 + i
            eng.now_h = h
            layers: list[tuple[int, dict, str]] = []
            if any_valid and valid[i]:
                self.last_data_h = h
                for kind, k in dq_events.get(i, ()):
                    if kind == "start":
                        self.dq_active[k] = h
                        eng.event(h, a, "DATA", "P3", f"Sensor {a.hourly[k].name} tidak berubah selama 6 jam (flatline). Periksa transmitter; "
                                                      "model AI berhenti menilai aset ini sampai sensor pulih.")
                    else:
                        self.dq_active.pop(k, None)
                        eng.event(h, a, "DATA", "-", f"Sensor {a.hourly[k].name} kembali memberi nilai normal.")
                if mb["fit_row"] == i:
                    inf = self.model.info
                    eng.event(h, a, "MODEL", "-", f"Model AI selesai dilatih dari {inf['n']} jam data normal "
                                                  f"({inf['k']} komponen, {inf['explained'] * 100:.0f}% variansi). Mulai menilai data baru.")
                r = self.hr.row(i, h)
                if r is not None:
                    if r["level"]:
                        layers.append((r["level"], r["reason"], "Batas per jam"))
                    self.last_health = r["health"]
                if pos is not None and pos[i] >= 0:
                    j = int(pos[i])
                    ratio = float(mb["ratio"][j])
                    self.t2[h], self.spe[h], self.ratio[h] = mb["t2"][j], mb["spe"][j], ratio
                    self.c1 = self.c1 + 1 if ratio > 1 else 0
                    self.c5 = self.c5 + 1 if ratio > 5 else 0
                    last_scored = j
                    # The anomaly model alone raises P2. Its size says "how unusual", not "how soon",
                    # so P1 needs confirmation from a physical limit or trend layer.
                    confirmed = max(self.hr.level, self.cm.level if self.cm is not None else 0) >= 2
                    lvl = 3 if (self.c5 >= 3 and confirmed) else 2 if self.c1 >= 3 else 0
                    cur = self.episode["level"] if self.episode else 0
                    if lvl > cur:
                        contrib = self._contrib(mb, j)
                        top = a.mspc_idx[int(np.argmax(contrib))]
                        self.mspc_last = {"t2": float(mb["t2"][j]), "spe": float(mb["spe"][j]), "ratio": ratio,
                                          "stat": "SPE" if mb["is_spe"][j] else "T2", "contrib": contrib, "h": h, "top": top}
                        layers.append((lvl, {"type": "mspc", "stat": self.mspc_last["stat"], "ratio": ratio, "k": top}, "AI (MSPC)"))
            if weekly and h in weekly:
                wv, wreal = weekly[h]
                c = self.cm.update(h, wv)
                self.cm_log.append({"h": h, "v": [float(v) for v in wv], "level": c["level"], "health": c["health"], "real": wreal})
                self.last_health = c["health"]
            if self.cm is not None and self.cm.level:
                layers.append((self.cm.level, self.cm.last["reason"], "Condition monitoring"))
            cur = self.episode["level"] if self.episode else 0
            lvl = max((l[0] for l in layers), default=0)
            if lvl > cur:
                best = sorted((l for l in layers if l[0] == lvl), key=lambda l: LAYER_ORDER[l[2]])[0]
                self._escalate(h, lvl, best[1], best[2])
            if self.episode:
                self.status = NAMES[self.episode["level"]]
                self.episode["pred_h"] = self.pred_h(h)
            elif self.restored_h is not None and h - self.restored_h < 24:
                self.status = "PULIH"
            else:
                self.status = "NORMAL" if (self.last_data_h is not None or (self.cm is not None and self.cm.readings)) else "NODATA"
            self.code[h] = CODE[self.status]
            if self.last_health is not None:
                self.health[h] = self.last_health
        if last_scored is not None:
            j = last_scored
            contrib = self._contrib(mb, j)
            self.mspc_last = {"t2": float(mb["t2"][j]), "spe": float(mb["spe"][j]), "ratio": float(mb["ratio"][j]),
                              "stat": "SPE" if mb["is_spe"][j] else "T2", "contrib": contrib, "h": int(s0 + np.nonzero(pos == j)[0][0]),
                              "top": a.mspc_idx[int(np.argmax(contrib))]}

    # ------------------------------------------------------------------ helpers
    def pred_h(self, now: int) -> int | None:
        c = []
        if self.cm is not None and self.cm.last and self.cm.last.get("pred"):
            c.append(self.cm.last["pred"]["h"])
        if self.hr.last and self.hr.last.get("pred"):
            c.append(self.hr.last["pred"]["h"])
        c = [x for x in c if x > now]
        return min(c) if c else None

    def reason_text(self, reason: dict, layer: str) -> str:
        a = self.a
        t = reason["type"]
        if t == "mspc":
            s = a.hourly[reason["k"]]
            return (f"Model AI mendeteksi pola tidak normal ({'hubungan antar-tag rusak' if reason['stat'] == 'SPE' else 'jauh dari operasi normal'}, "
                    f"{reason['ratio']:.1f}× batas) selama 3 jam berturut-turut. Kontributor terbesar: {s.name}.")
        if layer == "Condition monitoring":
            sigs, v, base = a.weekly, self.cm.last["v"], self.cm.base
        else:
            sigs, v, base = a.hourly, (self.hr.last["si"] if reason["type"] == "drift" else self.hr.last["sm"]), self.hr.base
        k = reason["k"]
        s = sigs[k]
        val = f"{fv(v[k])} {s.unit}"
        if t == "drift":
            return f"{s.name} bergeser {abs(v[k] - base[k]) / abs(base[k]) * 100:.0f}% dari baseline ({val})."
        if t == "alarm":
            return f"{s.name} {val} melewati batas alarm {fv(s.alarm)}."
        if t == "trip":
            return f"{s.name} {val} melewati batas trip {fv(s.trip)}."
        pred = (self.cm.last if layer == "Condition monitoring" else self.hr.last)["pred"]
        days = round((pred["h"] - self.eng.now_h) / 24) if pred else None
        return f"Tren {s.name} diproyeksikan melewati batas trip sekitar {fmt_date(pred['h'])}" + (f" ({days} hari lagi)." if days is not None else ".")

    def _escalate(self, h: int, lvl: int, reason: dict, layer: str) -> None:
        a = self.a
        if not self.episode:
            self.episode = {"start": h, "level": 0, "first": {}, "alert_id": f"{a.id}@{h}"}
            self.eng.alert_open(a, self.episode, h)
        self.episode["level"] = lvl
        self.episode["first"][lvl] = h
        self.eng.now_h = h
        text = self.reason_text(reason, layer)
        self.eng.alert_update(self.episode["alert_id"], lvl, h, text, layer)
        self.eng.event(h, a, NAMES[lvl], PRIO[lvl], text, layer)

    def _close_episode(self, h: int, outcome: str) -> None:
        if self.episode:
            self.eng.alert_close(self.episode["alert_id"], h, outcome)
            self.episode = None

    def _after_repair(self) -> None:
        if self.cm is not None:
            self.cm.reset_segment()
        self.hr.reset_segment()
        self.c1 = self.c5 = 0
        self.episode = None


class PlantEngine:
    def __init__(self, assets: list[Asset], store):
        self.assets = assets
        self.by_id = {a.id: a for a in assets}
        self.store = store
        self.hist = SimulatedHistorian(assets)
        self.mode = "reality"
        self.running = False
        self.speed = DEFAULT_SPEED
        self.pause_on_alert = True
        self.epoch = 0
        self.reset()

    # ------------------------------------------------------------------ lifecycle
    def reset(self) -> None:
        self.hist.reset()
        self.now = -1
        self.now_h = 0
        self.monitors = {a.id: Monitor(a, self) for a in self.assets}
        self.events: list[dict] = []
        self.alerts: dict[str, dict] = {}
        self.losses: dict[str, dict] = {}
        self.auto_due: dict[str, int] = {}
        self.manual = self.store.manual_ivs() if self.mode == "manual" else {}
        self._new: list[dict] = []
        self.epoch += 1

    def advance(self, to_h: int, pause: bool = True) -> dict:
        """Process hours up to to_h. Replays run in one-day blocks; live play with pause-on-alert
        runs hour by hour so the clock stops exactly at the alert. Interventions always start a new block."""
        start = self.now + 1
        to_h = min(to_h, N_HOURS - 1)
        self._new = []
        paused = None
        fine = pause and self.pause_on_alert
        h = start
        while h <= to_h:
            end = h if fine else min(to_h, (h // 24 + 1) * 24 - 1)
            for aid in self.monitors:
                if (self.mode == "manual" and self.manual.get(aid) == h) or (self.mode == "auto" and self.auto_due.get(aid) == h):
                    self.hist.intervene(aid, h)
            dues = [d for d in list(self.manual.values()) + list(self.auto_due.values()) if h < d <= end]
            if dues:
                end = min(dues) - 1
            mark_new, mark_ev = len(self._new), len(self.events)
            for m in self.monitors.values():
                m.advance(h, end)
            if len(self.events) - mark_ev > 1:
                self.events[mark_ev:] = sorted(self.events[mark_ev:], key=lambda e: e["h"])
                self._new[mark_new:] = sorted(self._new[mark_new:], key=lambda e: e["h"])
            if self.mode == "auto":
                for m in self.monitors.values():
                    self._auto_schedule(m, end)
            self.now = end
            if fine and any(e["type"] in STOPPERS for e in self._new[mark_new:]):
                paused = end
                break
            h = end + 1
        return {"from": start, "to": self.now, "events": self._new, "paused": paused}

    def _auto_schedule(self, m: Monitor, h: int) -> None:
        aid = m.a.id
        if not m.episode or self.hist.intervened(aid):
            return
        f = m.episode["first"]
        t2 = f.get(2, f.get(3))
        if t2 is None:
            return
        due = t2 + 7 * 24
        if 3 in f:
            due = min(due, f[3] + 24)
        self.auto_due[aid] = max(due, h + 1)

    def seek(self, h: int) -> None:
        h = max(0, min(h, N_HOURS - 1))
        self.store.prune_after(h)
        self.running = False
        self.reset()
        self.advance(h, pause=False)

    def set_mode(self, mode: str) -> None:
        target = self.now
        self.mode = mode
        self.reset()
        self.advance(target, pause=False)

    def request_intervention(self, aid: str) -> dict:
        a = self.by_id[aid]
        h = self.now + 1
        if self.mode != "manual":
            return {"ok": False, "message": "Intervensi manual hanya tersedia di mode Manual."}
        if self.hist.intervened(aid) or aid in self.manual:
            return {"ok": False, "message": "Intervensi untuk aset ini sudah dijadwalkan."}
        if a.trip_start is not None and h >= a.trip_start and h < (a.trip_end or h + 1):
            return {"ok": False, "message": "Aset sedang trip."}
        self.manual[aid] = h
        self.store.set_manual_iv(aid, h)
        return {"ok": True, "h": h, "message": f"Intervensi {aid} dijadwalkan {fmt_datetime(h)}."}

    # ------------------------------------------------------------------ records
    def event(self, h: int, a: Asset, typ: str, prio: str, text: str, layer: str = "") -> None:
        e = {"h": h, "assetId": a.id, "source": a.source, "type": typ, "prio": prio, "text": text, "layer": layer}
        self.events.append(e)
        self._new.append(e)

    def book_loss(self, a: Asset, h: int, kind: str) -> None:
        self.losses[a.id] = {"kind": kind, "h": h, "loss": a.trip_loss if kind == "trip" else a.planned_loss}

    def alert_open(self, a: Asset, ep: dict, h: int) -> None:
        self.alerts[ep["alert_id"]] = {"id": ep["alert_id"], "assetId": a.id, "source": a.source, "raisedH": h, "level": 0, "levelH": h,
                                       "first": {}, "reason": "", "layer": "", "open": True, "outcome": None, "closedH": None}

    def alert_update(self, aid: str, lvl: int, h: int, text: str, layer: str) -> None:
        al = self.alerts[aid]
        al.update(level=lvl, levelH=h, reason=text, layer=layer)
        al["first"][lvl] = h

    def alert_close(self, aid: str, h: int, outcome: str) -> None:
        al = self.alerts[aid]
        al.update(open=False, closedH=h, outcome=outcome)

    # ------------------------------------------------------------------ views
    def alert_view(self, al: dict, acks: dict, wos: dict) -> dict:
        a = self.by_id[al["assetId"]]
        m = self.monitors[a.id]
        pred = m.episode.get("pred_h") if (al["open"] and m.episode and m.episode["alert_id"] == al["id"]) else None
        days = (pred - self.now) / 24 if pred is not None else None
        p = p_fail(al["level"], days) if al["open"] else 0.0
        due = al["levelH"] + SLA_HOURS.get(al["level"], 168)
        ack = acks.get(al["id"])
        wo = wos.get(al["id"])
        return {**{k: v for k, v in al.items() if k != "first"}, "first": {str(k): v for k, v in al["first"].items()},
                "prio": PRIO[al["level"]], "status": NAMES[al["level"]], "predH": pred, "p": p, "varUsd": round(p * a.trip_loss, 1),
                "dueH": due, "ack": ack, "woId": wo["id"] if wo else None, "woStatus": wo["status"] if wo else None,
                "overdue": bool(al["open"] and self.now > due and not ack and not wo and not self.hist.intervened(a.id)),
                "owner": a.pic, "disc": a.disc, "tripLoss": a.trip_loss, "oldScore": (a.incident or {}).get("score"),
                "oldPreRisk": (a.incident or {}).get("prerisk"), "scheduledH": self.hist.iv.get(a.id) or self.manual.get(a.id) or self.auto_due.get(a.id)}

    def asset_summary(self, m: Monitor) -> dict:
        a, now = m.a, self.now
        ep = m.episode
        hs = m.health[max(0, now - 13 * 24): now + 1: 24] if now >= 0 else []
        ratio = None
        if m.mspc_last and now - m.mspc_last["h"] <= 2:
            ratio = float(m.mspc_last["ratio"])
        health = None if m.status in ("NODATA", "MAINT") else (0 if m.status == "TRIP" else m.last_health)
        al = self.alerts.get(ep["alert_id"]) if ep else None
        return {"id": a.id, "source": a.source, "status": m.status, "prio": PRIO[ep["level"]] if ep else "-",
                "health": None if health is None else int(health), "reason": al["reason"] if al else "", "layer": al["layer"] if al else "",
                "predH": ep.get("pred_h") if ep else None, "alertId": ep["alert_id"] if ep else None,
                "mspc": {"state": "ready" if m.model.ready else ("training" if m.model.buf else "waiting"), "progress": round(m.model.progress, 3),
                         "ratio": ratio},
                "dq": [a.hourly[k].name for k in m.dq_active] or None, "realNow": bool(now >= 0 and m.real[now]), "lastDataH": m.last_data_h,
                "healthTrend": [None if math.isnan(v) else round(float(v)) for v in hs],
                "scheduledH": self.hist.iv.get(a.id) or self.manual.get(a.id) or self.auto_due.get(a.id)}

    def kpis(self, alert_views: list[dict]) -> dict:
        now = self.now
        out = {"alerts": {"P1": 0, "P2": 0, "P3": 0}, "varUsd": 0.0, "overdue": 0}
        for al in alert_views:
            if al["open"]:
                out["alerts"][al["prio"]] = out["alerts"].get(al["prio"], 0) + 1
                out["varUsd"] += al["varUsd"]
                out["overdue"] += int(al["overdue"])
        reality_now = sum(a.trip_loss for a in self.assets if a.trip_start is not None and a.trip_start <= now)
        reality_end = sum(a.trip_loss for a in self.assets if a.trip_start is not None)
        scen_end = sum((a.planned_loss if self.hist.intervened(a.id) else (a.trip_loss if a.trip_start is not None else 0)) for a in self.assets)
        out["losses"] = {"realityNow": reality_now, "scenarioNow": sum(l["loss"] for l in self.losses.values()),
                         "realityEnd": reality_end, "scenarioEnd": scen_end}
        out["assets"] = len(self.assets)
        out["models"] = {"ready": sum(m.model.ready for m in self.monitors.values()), "total": len(self.monitors)}
        return out

    def snapshot(self, events_limit: int = 150) -> dict:
        acks = self.store.acks()
        wos = {w["alertId"]: w for w in self.store.workorders()}
        views = [self.alert_view(al, acks, wos) for al in self.alerts.values()]
        recent = [v for v in views if v["open"] or (v["closedH"] is not None and self.now - v["closedH"] <= 30 * 24)]
        return {"now": self.now, "nowIso": iso(self.now), "running": self.running, "speed": self.speed, "mode": self.mode,
                "pauseOnAlert": self.pause_on_alert, "epoch": self.epoch,
                "assets": [self.asset_summary(m) for m in self.monitors.values()],
                "alerts": recent, "events": self.events[-events_limit:], "kpis": self.kpis(views)}

    @staticmethod
    def real_share(m: Monitor) -> float | None:
        """Share of the model's training hours that were real competition data (the rest is DUMMY fill)."""
        tr = m.model.trained_range
        return None if tr is None else float(m.real[tr[0]:tr[1] + 1].mean())

    def asset_history(self, aid: str, hours: int) -> dict:
        m, a = self.monitors[aid], self.by_id[aid]
        h1 = max(self.now, 0)
        h0 = max(0, h1 - hours + 1)
        step = max(1, math.ceil((h1 - h0 + 1) / 1500))
        idx = list(range(h0, h1 + 1, step))

        def col(arr):
            return [None if math.isnan(float(v)) else round(float(v), 5) for v in arr]
        vals = [col(m.hv[h0:h1 + 1:step, k]) for k in range(len(a.hourly))]
        cm_preds = []
        if m.cm is not None and m.cm.last and m.cm.last.get("preds"):
            cm_preds = m.cm.last["preds"]
        hr_preds = m.hr.last.get("preds", []) if m.hr.last else []
        contrib = None
        if m.mspc_last:
            contrib = {"h": m.mspc_last["h"], "stat": m.mspc_last["stat"], "ratio": float(m.mspc_last["ratio"]),
                       "keys": [a.hourly[i].name for i in a.mspc_idx], "values": [round(float(v), 4) for v in m.mspc_last["contrib"]]}
        return {"assetId": aid, "h": idx, "values": vals, "t2": col(m.t2[h0:h1 + 1:step]), "spe": col(m.spe[h0:h1 + 1:step]),
                "ratio": col(m.ratio[h0:h1 + 1:step]), "code": [int(v) for v in m.code[h0:h1 + 1:step]], "health": col(m.health[h0:h1 + 1:step]),
                "real": [int(v) for v in m.real[h0:h1 + 1:step]],
                "model": {**m.model.info, "ready": m.model.ready, "progress": m.model.progress, "trainedRange": m.model.trained_range,
                          "nTrain": m.model.n_train, "realShare": self.real_share(m)},
                "hrBase": None if m.hr.base is None else [round(float(v), 5) for v in m.hr.base],
                "cm": [c for c in m.cm_log if c["h"] <= h1], "cmBase": None if (m.cm is None or m.cm.base is None) else [float(v) for v in m.cm.base],
                "cmPreds": cm_preds, "hrPreds": hr_preds, "contrib": contrib,
                "events": [e for e in self.events if e["assetId"] == aid][-60:], "trip": self.losses.get(aid)}
