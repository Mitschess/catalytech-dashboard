"""RCA assistant: probable-root-cause hypotheses, similar-incident retrieval and an RCA draft.

Everything here only uses data and incidents dated at or before the current simulated hour.
"""
from __future__ import annotations

import re

import numpy as np

from .engine import NAMES, PRIO, fv, usd
from .timeutil import fmt_date, fmt_datetime

KB = {
    "PU": [
        dict(id="PU-DRY", title="Seal kering (dry-running): seal-flush rendah / NPSH marginal", mech="Leakage", comp=["Mechanical Seal", "Seal"],
             w={"sealflush": 4, "dischp": 1, "vib": 1, "btemp": 0.5},
             checks=["Ukur seal-flush flow vs minimum desain 6 L/min (API 682 Plan 11)", "Periksa orifice & strainer jalur flush",
                     "Cek tekanan suction & margin NPSH saat feed swing", "Periksa seal pot dan tanda weep di area seal"],
             actions=["Pulihkan seal-flush flow >= 6 L/min", "Pindah terencana ke pompa cadangan sebelum seal gagal",
                      "Pasang flow switch + alarm DCS, batasi ramp feed <= 1 T/H per menit"]),
        dict(id="PU-BRG", title="Degradasi bearing pompa", mech="Worn Out", comp=["Bearing"], w={"btemp": 3, "vib": 2},
             checks=["Analisis spektrum vibrasi pada frekuensi cacat bearing", "Sampel oli bearing housing", "Cek level oli & constant-level oiler"],
             actions=["Rencanakan penggantian bearing saat pompa cadangan berjalan", "Tambahkan trend suhu & vibrasi bearing ke rute harian"]),
        dict(id="PU-RUB", title="Gesekan impeller / wear ring aus (daya naik tanpa kenaikan flow)", mech="Low Performance", comp=["Impeller", "Motor"],
             w={"amps": 3, "btemp": 1}, neg={"flow": 1},
             checks=["Bandingkan ampere dengan kurva daya pada flow yang sama", "Ukur clearance wear ring saat inspeksi", "Cek kelurusan poros & run-out"],
             actions=["Jadwalkan inspeksi impeller & wear ring", "Pantau rasio ampere/flow setiap hari sampai inspeksi"]),
        dict(id="PU-CAV", title="Kavitasi / operasi jauh dari titik efisiensi terbaik", mech="High Vibration", comp=["Impeller"], w={"dischp": 3, "vib": 1},
             checks=["Bandingkan titik operasi dengan kurva pompa", "Cek level vessel suction & strainer"],
             actions=["Stabilkan level suction, tinjau SOP ramp feed"]),
    ],
    "CO": [
        dict(id="CO-H2O", title="Kontaminasi air pada lube-oil (kebocoran tube cooler)", mech="High Vibration", comp=["Bearing", "Journal Bearing"],
             w={"water": 4, "bmt": 1, "vib": 1, "lop": 0.5},
             checks=["Uji Karl Fischer sampel oli (spesifikasi < 500 ppm)", "Leak test / konduktivitas air pendingin lube-oil cooler",
                     "Cek status purifier / coalescer", "Trend level reservoir oli"],
             actions=["Isolasi cooler bocor dan plug tube", "Jalankan purifier terus-menerus sebagai mitigasi", "Flushing/ganti oli saat stop terkendali",
                      "Pasang sensor water-in-oil online"]),
        dict(id="CO-FILM", title="Film oli melemah sehingga journal bearing mengalami distress", mech="High Vibration", comp=["Journal Bearing", "Bearing"],
             w={"vib": 3, "bmt": 3, "lop": 1, "water": 1},
             checks=["Orbit & spektrum vibrasi (1X, sub-sinkron)", "Trend suhu metal bearing terhadap beban", "Tekanan header oli & dP filter"],
             actions=["Rencanakan stop terkendali untuk inspeksi bearing", "Perketat alert vibrasi ke 45 micron"]),
        dict(id="CO-LOP", title="Gangguan suplai lube-oil (pompa / filter)", mech="Low Performance", comp=["Valve"], w={"lop": 3, "bmt": 1}, neg={"water": 1},
             checks=["dP filter lube-oil", "Uji start pompa auxiliary", "Cek PCV/PSV header"], actions=["Ganti elemen filter, perbaiki kontrol tekanan"]),
        dict(id="CO-MECH", title="Masalah mekanis rotor (unbalance / misalignment)", mech="High Vibration", comp=["Rotor", "Coupling"], w={"vib": 3},
             neg={"water": 2, "bmt": 1}, checks=["Fase & amplitudo 1X/2X", "Riwayat alignment dan balancing"], actions=["Balancing / re-alignment pada jadwal stop"]),
    ],
    "EM": [
        dict(id="EM-GRS", title="Degradasi grease bearing motor (re-lubrikasi terlambat)", mech="Overheat", comp=["Bearing", "Motor Bearing"],
             w={"mtemp": 4, "mvib": 2, "wtemp": 0.5},
             checks=["Riwayat re-greasing terhadap interval", "Thermography & shock-pulse bearing DE", "Sampel grease (warna, karbonisasi)"],
             actions=["Re-grease terukur atau ganti bearing saat pompa standby berjalan", "Ubah interval re-greasing menjadi berbasis risiko (4 bulan)",
                      "Tambahkan trend suhu bearing ke CMMS"]),
        dict(id="EM-OVL", title="Beban lebih / masalah hidrolik pompa", mech="Overheat", comp=["Motor", "Impeller"], w={"amp": 3, "wtemp": 2},
             checks=["Bandingkan arus dengan rating", "Cek impeller & bukaan valve discharge"], actions=["Kembalikan titik operasi, inspeksi impeller"]),
        dict(id="EM-VNT", title="Pendinginan motor terganggu", mech="Overheat", comp=["Motor"], w={"wtemp": 3, "mtemp": 1}, neg={"mvib": 1},
             checks=["Cek fan cowl & louvre", "Suhu ambient ruang motor"], actions=["Bersihkan fan cowl, perbaiki ventilasi"]),
    ],
    "HB": [
        dict(id="HB-FOUL", title="Fouling tube-side dipicu heavy-ends feed di atas desain", mech="Fouling", comp=["Tube Bundle"],
             w={"dp": 4, "heavy": 3, "duty": 2, "cot": 1},
             checks=["Analisis heavy-ends feed (desain < 1,5%)", "Trend dP filter hulu", "Hitung fouling factor & heat duty"],
             actions=["Bypass ke spare train dan hydro-jet cleaning terencana", "Perketat kontrol heavy-ends & filtrasi",
                      "Pasang trigger pembersihan berbasis dP (0,55 bar) dengan hysteresis"]),
        dict(id="HB-RUN", title="Fouling normal akhir run (feed sesuai spesifikasi)", mech="Fouling", comp=["Tube Bundle"], w={"dp": 3, "duty": 3, "cot": 2},
             neg={"heavy": 2}, checks=["Bandingkan laju kenaikan dP dengan run sebelumnya"], actions=["Jadwalkan cleaning sesuai tren"]),
        dict(id="HB-INS", title="Pembacaan dP / transmitter bermasalah", mech="Error", comp=["Transmitter"], w={"dp": 3}, neg={"duty": 2, "cot": 2},
             checks=["Kalibrasi transmitter dP", "Bandingkan dengan pengukuran lokal"], actions=["Kalibrasi / ganti transmitter"]),
    ],
    "BL": [
        dict(id="BL-MIS", title="Misalignment kopling (diperparah soft-foot)", mech="High Vibration", comp=["Coupling"],
             w={"offset": 4, "h2x": 3, "vib": 1, "btemp": 0.5},
             checks=["Laser alignment (spesifikasi < 0,05 mm)", "Cek soft-foot di setiap kaki", "Spektrum vibrasi: dominan 2X"],
             actions=["Re-alignment & re-shim baseplate saat stop terencana", "Ganti elemen kopling", "Masukkan alignment 6-bulanan ke PM"]),
        dict(id="BL-CPL", title="Elemen kopling aus / melewati umur", mech="Worn Out", comp=["Coupling"], w={"h2x": 3, "offset": 1, "vib": 1},
             checks=["Umur elemen (rekomendasi 12 bulan)", "Inspeksi visual retak / aus"], actions=["Ganti elemen, buat register umur kopling"]),
        dict(id="BL-UNB", title="Unbalance rotor / deposit di impeller", mech="High Vibration", comp=["Rotor", "Impeller"], w={"vib": 3},
             neg={"h2x": 1, "offset": 1}, checks=["Amplitudo 1X terhadap grade balance", "Inspeksi deposit di impeller"], actions=["Bersihkan / balancing rotor"]),
        dict(id="BL-BRG", title="Kerusakan bearing blower", mech="Worn Out", comp=["Bearing"], w={"btemp": 3, "vib": 1},
             checks=["Envelope / shock-pulse", "Sampel pelumas"], actions=["Ganti bearing terencana"]),
    ],
}
DESIGN = {"PU-2101B": {"sealflush": 6.0}}  # datasheet minimum seal-flush flow, used as the evidence span
MECH_FAM = {"High Vibration": ["High Vibration", "Loose", "Worn Out"], "Worn Out": ["Worn Out", "High Vibration", "Breakage"], "Leakage": ["Leakage"],
            "Overheat": ["Overheat", "Worn Out"], "Fouling": ["Fouling", "Low Performance"], "Low Performance": ["Low Performance", "Fouling", "Worn Out"],
            "Error": ["Error", "Malfunction"]}


def _tokens(s: str) -> set[str]:
    return {w for w in re.sub(r"[^a-z0-9 ]", " ", str(s).lower()).split() if len(w) > 2}


def condition(eng, aid: str) -> dict:
    """Latest readings per signal with baseline, limits and a G / CEK / NG result."""
    m, a = eng.monitors[aid], eng.by_id[aid]
    rows = []
    if m.cm is not None and m.cm.last is not None and m.cm.base is not None:
        v, b = m.cm.last["v"], m.cm.base
        for k, s in enumerate(a.weekly):
            ng = (v[k] - s.alarm) * s.dir >= 0
            chk = not ng and (v[k] - b[k]) * s.dir / abs(b[k]) > 0.10
            rows.append({"key": s.key, "name": s.name, "unit": s.unit, "value": float(v[k]), "base": float(b[k]), "alarm": s.alarm, "trip": s.trip,
                         "rel": float((v[k] - b[k]) / abs(b[k])), "result": "NG" if ng else "CEK" if chk else "G", "period": "mingguan", "h": m.cm.last["h"]})
    if m.last_data_h is not None:
        x = m.hv[m.last_data_h].astype(float)
        base = m.hr.base if m.hr.base is not None else (m.model.mu if m.model.ready else None)
        for k, s in enumerate(a.hourly):
            if not s.mspc and s.trip is None:
                continue
            b = None
            if m.hr.base is not None:
                b = float(m.hr.base[k])
            elif m.model.ready and k in a.mspc_idx:
                b = float(m.model.mu[a.mspc_idx.index(k)])
            res = "G"
            if s.alarm is not None and (x[k] - s.alarm) * s.dir >= 0:
                res = "NG"
            elif b and abs(x[k] - b) / abs(b) > 0.10:
                res = "CEK"
            rows.append({"key": s.key, "name": s.name, "unit": s.unit, "value": float(x[k]), "base": b, "alarm": s.alarm, "trip": s.trip,
                         "rel": None if not b else float((x[k] - b) / abs(b)), "result": res, "period": "per jam", "h": m.last_data_h})
    return {"rows": rows}


def evidence(eng, aid: str) -> dict[str, float]:
    """0..1 per signal key: how far each signal has moved from baseline toward its alarm (or design) limit,
    raised by the anomaly model's contribution share when the model is in alarm."""
    m, a = eng.monitors[aid], eng.by_id[aid]
    e: dict[str, float] = {}

    def put(key, val):
        e[key] = max(e.get(key, 0.0), float(np.clip(val, 0, 1)))
    if m.cm is not None and m.cm.last is not None and m.cm.base is not None:
        v, b = m.cm.last["v"], m.cm.base
        for k, s in enumerate(a.weekly):
            lim = DESIGN.get(a.id, {}).get(s.key, s.alarm)
            span = (lim - b[k]) * s.dir
            put(s.key, (v[k] - b[k]) * s.dir / span if span > 0 else 0)
    if m.hr.last is not None and m.hr.base is not None:
        sm, b = m.hr.last["sm"], m.hr.base
        for k, s in enumerate(a.hourly):
            if s.alarm is None:
                continue
            span = (s.alarm - b[k]) * s.dir
            put(s.key, (sm[k] - b[k]) * s.dir / span if span > 0 else 0)
    ml = m.mspc_last
    if ml and ml["ratio"] > 1 and eng.now - ml["h"] <= 6:
        c = ml["contrib"] / max(ml["contrib"].max(), 1e-12)
        strength = min(1.0, np.log10(ml["ratio"]) / np.log10(5) + 0.4)
        for j, k in enumerate(a.mspc_idx):
            put(a.hourly[k].key, c[j] * strength)
    return e


def hypotheses(eng, aid: str) -> list[dict]:
    a = eng.by_id[aid]
    e = evidence(eng, aid)
    keys = {s.key for s in a.weekly} | {s.key for s in a.hourly}
    out = []
    for h in KB.get(a.type_code, []):
        w = {k: v for k, v in h["w"].items() if k in keys}
        if not w:
            continue
        num = sum(v * e.get(k, 0) for k, v in w.items()) - sum(v * e.get(k, 0) for k, v in h.get("neg", {}).items() if k in keys)
        den = sum(w.values())
        ev = [{"key": k, "e": round(e.get(k, 0), 3), "pos": True} for k in w] + \
             [{"key": k, "e": round(e.get(k, 0), 3), "pos": False} for k in h.get("neg", {}) if k in keys and e.get(k, 0) > 0.15]
        out.append({**{k: h[k] for k in ("id", "title", "mech", "comp", "checks", "actions")}, "score": float(np.clip(num / den, 0, 1)), "evidence": ev})
    return sorted(out, key=lambda x: -x["score"])


def similar(eng, incidents: list[dict], aid: str, hyp: dict | None, limit: int = 6) -> list[dict]:
    if not hyp:
        return []
    a = eng.by_id[aid]
    q = _tokens(hyp["title"] + " " + " ".join(hyp["comp"]) + " " + hyp["mech"])
    fam = MECH_FAM.get(hyp["mech"], [hyp["mech"]])
    res = []
    for r in incidents:
        if r["h"] > eng.now or r["tag"] == aid:
            continue
        ty = 1 if r["type"] == a.type_code else 0
        me = 1 if r["fm"] == hyp["mech"] else 0.5 if r["fm"] in fam else 0
        co = 1 if (r["comp"] in hyp["comp"] or r["comp_std"] in hyp["comp"]) else 0
        tk = _tokens(f"{r['title']} {r['comp']} {r['fm']}")
        inter = len(tk & q)
        tx = inter / (len(tk) + len(q) - inter) if tk else 0
        res.append((0.35 * ty + 0.3 * me + 0.25 * co + 0.1 * tx, r))
    res.sort(key=lambda x: (-x[0], -x[1]["tot"]))
    return [{"score": round(s, 3), "id": r["id"], "tag": r["tag"], "title": r["title"], "plant": r["plant"], "type": r["type"], "comp": r["comp"],
             "fm": r["fm"], "date": r["date"], "status": r["status"], "loss": r["tot"]} for s, r in res[:limit]]


def lessons(eng, aid: str, hyp: dict | None) -> list[dict]:
    """Structured RCA reports that were already published at the current simulated time."""
    a = eng.by_id[aid]
    out = []
    for x in eng.assets:
        if x.rca is None or x.id == aid or x.rca["date_rep_h"] > eng.now:
            continue
        same_type = x.type_code == a.type_code
        same_mech = hyp is not None and x.incident["fm"] == hyp["mech"] and x.incident["comp_std"] in hyp["comp"]
        if same_type or same_mech:
            out.append({"ar": x.rca["ar"], "tag": x.id, "rootCause": x.rca["root_cause"],
                        "actions": [c["action"] for c in x.rca["capa"]][:4]})
    return out


def draft(eng, aid: str, hyps: list[dict]) -> str:
    m, a = eng.monitors[aid], eng.by_id[aid]
    ep = m.episode
    al = eng.alerts.get(ep["alert_id"]) if ep else None
    cond = condition(eng, aid)["rows"]
    top = hyps[0] if hyps else None
    L = ["DRAF ABNORMALITY REPORT (dibuat otomatis oleh Catalytech SIGAP, wajib diverifikasi engineer)",
         "Form acuan       : RCA-F-0075-02 / Prosedur RCA-P-0050-03",
         f"Tanggal draf     : {fmt_datetime(eng.now)}",
         f"Aset             : {a.id} {a.short} | Class {a.cls} | {a.plant}",
         f"Data per jam     : {'asli (PI panitia)' if eng.now >= 0 and m.real[eng.now] else 'DUMMY isian (pola operasi normal buatan)'}",
         f"Disiplin / PIC   : {a.disc} / {a.pic}",
         f"Status           : {m.status}" + (f" ({PRIO[ep['level']]}) sejak {fmt_date(ep['start'])}" if ep else ""),
         f"Judul usulan     : {a.id} - {top['title'] if top else 'Pemantauan kondisi'}", "",
         "PROBLEM STATEMENT (usulan)",
         (al["reason"] if al else "Belum ada penyimpangan berarti.") +
         (f" Diproyeksikan melewati batas trip sekitar {fmt_date(ep['pred_h'])} bila tidak ada tindakan." if ep and ep.get("pred_h") else ""), "",
         "KRONOLOGI (dari log kejadian)"]
    evs = [e for e in eng.events if e["assetId"] == aid][-12:]
    L += [f"- {fmt_datetime(e['h'])}  {e['type']}: {e['text']}" for e in evs] or ["- Belum ada kejadian."]
    L += ["", "VERIFIKASI PARAMETER (4P)"]
    for i, r in enumerate(cond, 1):
        L.append(f"P{i} {r['name'][:26]:<26} {fv(r['value']) + ' ' + r['unit']:<16} baseline {fv(r['base']) if r['base'] else '-':<9} "
                 f"alarm {fv(r['alarm']) if r['alarm'] is not None else '-':<8} {r['result']}")
    L += ["", "HIPOTESIS 4M+1E UNTUK DIVERIFIKASI"]
    for i, h in enumerate(hyps[:2], 1):
        L.append(f"{i}. {h['title']} (kecocokan bukti {h['score'] * 100:.0f}%)")
        L += [f"   - [ ] {c}" for c in h["checks"]]
    L += ["", "POTENSI DAMPAK (4W)", f"What  : {a.short} ({a.id})",
          f"When  : {'diperkirakan ' + fmt_date(ep['pred_h']) if ep and ep.get('pred_h') else 'belum dapat diproyeksikan'}",
          f"Scope : {a.plant}; cadangan: {a.spare}",
          f"Loss  : {usd(a.loss_per_h)}/jam x {fv(a.trip_hours)} jam = {usd(a.trip_loss)} jika trip; intervensi terencana ~{usd(a.planned_loss)}",
          "", "USULAN TINDAKAN"]
    L += [f"- {x}" for x in (top["actions"] if top else [])]
    L.append(f"- Owner: {a.pic} ({a.disc})")
    return "\n".join(L)


RULES = ("Kamu adalah reliability engineer senior di pabrik petrokimia. Jawab dalam Bahasa Indonesia yang ringkas dan teknis. "
         "Gunakan hanya data yang diberikan; katakan jika data tidak cukup. Jangan mengarang angka. "
         "Data per jam berlabel DUMMY adalah isian pola operasi normal buatan, bukan pengukuran; jangan jadikan bukti kerusakan.")


def llm_context(eng, incidents: list[dict], aid: str) -> str:
    m, a = eng.monitors[aid], eng.by_id[aid]
    ep = m.episode
    al = eng.alerts.get(ep["alert_id"]) if ep else None
    hyps = hypotheses(eng, aid)
    L = [f"Waktu analisis: {fmt_datetime(eng.now)} (hanya data sampai waktu ini yang tersedia).",
         f"Aset: {a.id} {a.short}, {a.eq_type}, Class {a.cls}, {a.plant}. Kejadian nyata dari data panitia. Data per jam saat ini: {'asli (PI panitia)' if eng.now >= 0 and m.real[eng.now] else 'DUMMY isian (pola normal buatan, di luar jendela data PI asli)'}.",
         f"Cadangan: {a.spare}. Konsekuensi jika trip: {usd(a.loss_per_h)}/jam, durasi tipikal {fv(a.trip_hours)} jam.",
         f"Status: {m.status} {PRIO[ep['level']] if ep else ''}. Alasan: {al['reason'] if al else '-'} (lapisan: {al['layer'] if al else '-'})."]
    if ep and ep.get("pred_h"):
        L.append(f"Prediksi melewati batas trip: {fmt_date(ep['pred_h'])}.")
    L.append("Kondisi parameter (nilai | baseline | alarm | trip | hasil):")
    for r in condition(eng, aid)["rows"]:
        L.append(f"- {r['name']} ({r['unit']}, {r['period']}): {fv(r['value'])} | {fv(r['base']) if r['base'] else '-'} | "
                 f"{fv(r['alarm']) if r['alarm'] is not None else '-'} | {fv(r['trip']) if r['trip'] is not None else '-'} | {r['result']}")
    if m.mspc_last:
        ml = m.mspc_last
        names = [a.hourly[i].name for i in a.mspc_idx]
        order = np.argsort(-ml["contrib"])[:3]
        L.append(f"Model AI (MSPC) pada {fmt_datetime(ml['h'])}: {ml['stat']} = {ml['ratio']:.2f}x batas; kontributor: " +
                 ", ".join(f"{names[i]} {ml['contrib'][i] * 100:.0f}%" for i in order))
    if hyps:
        L.append("Hipotesis berbasis aturan (skor kecocokan bukti):")
        L += [f"- {h['title']}: {h['score'] * 100:.0f}%" for h in hyps]
        sims = similar(eng, incidents, aid, hyps[0])
        if sims:
            L.append("Insiden serupa di database (sebelum waktu analisis):")
            L += [f"- {s['date']} {s['tag']} {s['title']} | {s['comp']} | {s['fm']} | loss {usd(s['loss'])} | {s['status']}" for s in sims]
        les = lessons(eng, aid, hyps[0])
        if les:
            L.append("Pelajaran dari laporan RCA yang sudah terbit:")
            L += [f"- {x['tag']} ({x['ar']}): {x['rootCause']}" for x in les]
    return "\n".join(L)


TASK = ("Buat analisis probable root cause untuk aset ini dengan format:\n**Ringkasan kondisi** (2 kalimat)\n"
        "**Akar masalah paling mungkin** (maks 3, berurutan, masing-masing dengan alasan dari data)\n**Langkah verifikasi** (maks 4 bullet)\n"
        "**Rekomendasi tindakan & waktu** (maks 4 bullet, sebutkan apakah perlu stop terencana)\n"
        "**Risiko jika ditunda** (1-2 kalimat, pakai angka konsekuensi yang diberikan)\nMaksimal 260 kata.")
