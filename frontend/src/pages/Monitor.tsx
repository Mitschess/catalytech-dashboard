import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssetMeta, cssVar, days, fD, fDT, fv, getJSON, History, nf, Samples, send, SignalDef, UNIT_ORDER, usd } from "../api";
import { useLive } from "../live";
import type { Page } from "../App";
import { EChart } from "../components/EChart";
import { alpha, Band, hBars, Line, projection, Ref, timeChart } from "../charts";
import { EventRow, Info, Num, Panel, Prio, StatusChip } from "../components/ui";

const WINDOWS: [number, string][] = [[168, "7 hari"], [720, "30 hari"], [2160, "90 hari"]];
const MAX_STEP1 = 1500; // the backend returns every hour up to this many hours, then downsamples

/** Append live samples to the loaded history (only when the history has one point per hour). */
function merge(h: History, s: Samples, keep: number): History {
  const last = h.h.length ? h.h[h.h.length - 1] : -1;
  const idx: number[] = [];
  s.h.forEach((x, i) => { if (x > last) idx.push(i); });
  if (!idx.length) return h;
  const cat = <T,>(a: T[], b: T[]) => { const r = a.concat(idx.map((i) => b[i])); return r.length > keep ? r.slice(r.length - keep) : r; };
  return {
    ...h, h: cat(h.h, s.h), values: h.values.map((col, k) => cat(col, s.values[k])), t2: cat(h.t2, s.t2), spe: cat(h.spe, s.spe),
    ratio: cat(h.ratio, s.ratio), code: cat(h.code, s.code), health: cat(h.health, s.health), real: cat(h.real, s.real),
  };
}

/** Contiguous runs of trip (code 4) and planned intervention (code 5) hours, drawn as shaded bands. */
function outageBands(h: number[], code: number[]): Band[] {
  const out: Band[] = [];
  const trip = alpha(cssVar("--crit"), 0.13), maint = alpha(cssVar("--good"), 0.13);
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === 4 || c === 5) {
      let j = i;
      while (j + 1 < code.length && code[j + 1] === c) j++;
      out.push({ from: h[i], to: h[j] + 1, color: c === 4 ? trip : maint, label: c === 4 ? "Trip" : "Intervensi" });
      i = j + 1;
    } else i++;
  }
  return out;
}

function limitRefs(s: SignalDef, base: number | null | undefined): Ref[] {
  const r: Ref[] = [];
  if (base != null) r.push({ y: base, label: "baseline", color: cssVar("--ink-3"), dashed: true });
  if (s.alarm != null) r.push({ y: s.alarm, label: `alarm ${fv(s.alarm)}`, color: cssVar("--alarm") });
  if (s.trip != null) r.push({ y: s.trip, label: `trip ${fv(s.trip)}`, color: cssVar("--crit") });
  return r;
}

/** Keep the limit lines inside the visible y range. */
function yRange(vals: (number | null)[], refs: Ref[]): { yMin?: number; yMax?: number } {
  const xs = [...vals.filter((v): v is number => v != null), ...refs.map((r) => r.y)];
  if (!xs.length) return {};
  const lo = Math.min(...xs), hi = Math.max(...xs), pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
  return { yMin: +(lo - pad).toPrecision(4), yMax: +(hi + pad).toPrecision(4) };
}

export default function Monitor({ assetId, go }: { assetId: string | null; go: (p: Page, a?: string | null) => void }) {
  const { meta, snap, assetMeta, subscribe, onSamples, notify } = useLive();
  const id = assetId && assetMeta(assetId) ? assetId : meta!.assets[0].id;
  const m = assetMeta(id)!;
  const st = snap!.assets.find((a) => a.id === id)!;
  const [hours, setHours] = useState(168);
  const [hist, setHist] = useState<History | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const seq = useRef(0);
  const load = useCallback(async () => {
    const my = ++seq.current;
    try {
      const h = await getJSON<History>(`/api/assets/${encodeURIComponent(id)}/history?hours=${hours}`);
      if (my === seq.current) { setHist(h); setErr(null); }
    } catch (e) { if (my === seq.current) setErr((e as Error).message); }
  }, [id, hours]);

  // A seek, mode change or reset replays the plant (new epoch): drop the old curves first.
  useEffect(() => { setHist(null); }, [id, hours, snap!.epoch]);
  useEffect(() => { load(); }, [load, snap!.epoch]);
  // While paused, reload on every clock change (step, seek). While running, live samples stream in
  // over the WebSocket and a light periodic reload refreshes the weekly readings, model and predictions.
  useEffect(() => { if (!snap!.running) load(); }, [snap!.now, snap!.running, load]);
  useEffect(() => {
    if (!snap!.running) return;
    const t = window.setInterval(load, 2000);
    return () => clearInterval(t);
  }, [snap!.running, load]);
  useEffect(() => {
    subscribe(id);
    const off = onSamples((s) => { if (s.assetId === id && hours <= MAX_STEP1) setHist((h) => (h && h.assetId === id ? merge(h, s, hours) : h)); });
    return () => { off(); subscribe(null); };
  }, [id, hours, subscribe, onSamples]);

  const now = snap!.now;
  const charts = useMemo(() => buildCharts(m, hist, now, hours), [m, hist, now, hours]);
  const events = useMemo(() => snap!.events.filter((e) => e.assetId === id).slice().reverse(), [snap, id]);

  const intervene = async () => {
    setSending(true);
    try { const r = await send<{ message: string }>(`/api/assets/${encodeURIComponent(id)}/intervene`); notify(r.message); }
    catch (e) { notify((e as Error).message); }
    finally { setSending(false); }
  };
  const seekTo = (h: number) => send("/api/sim/control", "POST", { action: "seek", value: h }).catch((e) => notify((e as Error).message));

  const options = [...meta!.assets].sort((a, b) => UNIT_ORDER.indexOf(a.plantCode) - UNIT_ORDER.indexOf(b.plantCode));
  const hw = m.hourlyWindow, ww = m.weeklyWindow;
  const predDays = st.predH != null ? days(now, st.predH) : null;
  const md = hist?.model;
  const canIntervene = snap!.mode === "manual" && st.scheduledH == null && st.status !== "TRIP" && st.status !== "MAINT";

  const modelTxt = md?.ready
    ? `dilatih ${md.n} jam ${md.realShare === 0 ? "(isian dummy)" : md.realShare != null && md.realShare < 1 ? `(${nf(md.realShare * 100)}% PI asli)` : "(PI asli)"} · ${md.k} komponen · ${nf((md.explained ?? 0) * 100)}% variansi`
    : md && md.progress > 0 ? `belajar ${nf(md.progress * 100)}%` : "menunggu data";
  const dataTxt = `Data asli: PI per jam ${hw ? `${fD(hw[0])}–${fD(hw[1])}` : "–"}, mingguan ${ww ? `${fD(ww[0])}–${fD(ww[1])}` : "–"}. `
    + "Di luar itu garis ungu = isian dummy (pola normal dari hari normal aset ini). Tanda kerusakan hanya dari data asli.";

  return (
    <>
      <div className="toolbar">
        <select className="sel" aria-label="Pilih aset" value={id} onChange={(e) => go("monitor", e.target.value)}>
          {options.map((a) => <option key={a.id} value={a.id}>{a.plantCode} · {a.id} · {a.short}</option>)}
        </select>
        <h2>{m.id} <span className="muted" style={{ fontWeight: 500 }}>· {m.short}</span></h2>
        <Info text={dataTxt} />
        <div className="facts">
          <span>Class <b>{m.cls}</b></span><span>PIC <b>{m.pic}</b></span><span>Cadangan <b>{m.spare}</b></span>
          <span>Jika trip <b>{usd(m.tripLoss)}</b></span><span>Intervensi <b>{usd(m.plannedLoss)}</b></span>
        </div>
        <span className="sp" />
        <div className="seg" role="group" aria-label="Rentang waktu">
          {WINDOWS.map(([h, l]) => <button key={h} aria-pressed={hours === h} onClick={() => setHours(h)}>{l}</button>)}
        </div>
      </div>

      <div className={`banner st-b-${st.status}`}>
        <div><div className="big"><Num value={st.health} fmt={(v) => nf(v)} /></div><div className="xs muted">health</div></div>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ marginBottom: 3 }}><StatusChip status={st.status} /><Prio p={st.prio} />{st.layer && <span className="xs muted">{st.layer}</span>}
            {st.realNow ? <span className="src real">PI asli</span> : <span className="src dummy">Dummy</span>}</div>
          <div className="why">{st.reason || (st.dq ? `Sensor ${st.dq.join(", ")} flatline; AI berhenti menilai sampai sensor pulih.` : "Semua parameter normal.")}</div>
          <div className="row" style={{ marginTop: 7, gap: 6 }}>
            <button className="btn sm primary" onClick={() => go("rca", id)}>AI RCA</button>
            <button className="btn sm" onClick={() => go("alerts")}>Action Hub</button>
            {snap!.mode === "manual"
              ? <button className="btn sm" disabled={!canIntervene || sending} onClick={intervene} title="Mulai intervensi terencana pada jam berikutnya">
                {st.scheduledH != null ? `Intervensi ${fDT(st.scheduledH)}` : "Intervensi sekarang"}</button>
              : <span className="xs muted" title="Pilih mode Manual di bilah atas untuk menjadwalkan intervensi sendiri">intervensi: mode Manual</span>}
            {!st.realNow && hw && <button className="btn sm ghost" onClick={() => seekTo(Math.min(hw[0] + 24 * 7, hw[1]))}>Lompat ke data PI asli</button>}
          </div>
        </div>
        <div className="pred">
          {st.status === "MAINT" ? <>Intervensi berjalan<b>{fDT(st.scheduledH)}</b></>
            : st.predH != null ? <>Prediksi trip<b>{fD(st.predH)}</b>{predDays} hari lagi</>
              : st.scheduledH != null ? <>Intervensi dijadwalkan<b>{fDT(st.scheduledH)}</b></>
                : <>Prediksi trip<b>tidak ada</b></>}
        </div>
      </div>

      {err && <div className="empty" style={{ marginBottom: 12 }}>Gagal memuat riwayat aset: {err}</div>}

      {m.weekly.length > 0 && (
        <Panel title={<>Condition monitoring mingguan <Info text="Pembacaan rute mingguan. Garis putus-putus = proyeksi tren kuadratik menuju batas trip." /></>} sub={<Legend proj dummy />}>
          <div className="charts2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
            {m.weekly.map((s, k) => (
              <div className="cbox" key={s.key}>
                <div className="ch"><b title={s.name}>{s.name}</b><span className="cv">{hist?.cm.length ? `${fv(hist.cm[hist.cm.length - 1].v[k])} ${s.unit}` : "–"}</span></div>
                {charts?.weekly[k] ? <EChart option={charts.weekly[k]} height={140} label={`Tren mingguan ${s.name}`} /> : <div className="empty">Memuat…</div>}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="gap" />
      <Panel title="Sinyal proses per jam" sub={<Legend dummy train />}>
        <div className="charts2">
          {m.hourly.map((s, k) => {
            const col = hist?.values[k] ?? [];
            let lastV: number | null = null;
            for (let i = col.length - 1; i >= 0; i--) if (col[i] != null) { lastV = col[i]; break; }
            return (
              <div className="cbox" key={s.key}>
                <div className="ch"><b title={s.mspc ? s.name : `${s.name} (konteks, bukan input AI)`}>{s.name}{!s.mspc && <span className="muted" style={{ fontWeight: 400 }}> · konteks</span>}</b><span className="cv">{fv(lastV)} {s.unit}</span></div>
                {charts?.hourly[k] ? <EChart option={charts.hourly[k]} height={128} label={`Sinyal per jam ${s.name}`} /> : <div className="empty">Memuat…</div>}
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="gap" />
      <div className="grid g3">
        <Panel title={<>Skor anomali AI <Info text="Rasio T²/SPE terhadap batas 99,9% data normal (skala log). Di atas 1× selama 3 jam = alert P2; di atas 5× dan dikonfirmasi lapis lain = P1." /></>} sub={modelTxt}>
          {charts?.ai ? <EChart option={charts.ai} height={180} label="Skor anomali model AI" /> : <div className="empty">Memuat…</div>}
        </Panel>
        <Panel title={<>Kontributor anomali <Info text="Porsi tiap sinyal pada skor anomali terakhir: titik awal pemeriksaan di lapangan, bukan akar masalah final." /></>}
          sub={hist?.contrib ? `${hist.contrib.stat} ${nf(hist.contrib.ratio, 2)}× · ${fDT(hist.contrib.h)}` : undefined}>
          {charts?.contrib ? <EChart option={charts.contrib} height={180} label="Kontribusi tiap sinyal terhadap skor anomali" /> : <div className="empty">Menunggu model AI.</div>}
        </Panel>
        <Panel title="Kejadian aset" sub={`${events.length}`}>
          <div className="feed" style={{ maxHeight: 190 }}>
            {events.length ? events.map((e, i) => <EventRow key={`${e.h}-${i}`} e={e} showAsset={false} />) : <div className="empty">Belum ada kejadian.</div>}
          </div>
        </Panel>
      </div>
    </>
  );
}

function Legend({ train, proj, dummy }: { train?: boolean; proj?: boolean; dummy?: boolean }) {
  return (
    <span className="legend" style={{ marginTop: 0 }}>
      <span><i style={{ borderColor: "var(--s1)" }} />asli</span>
      {dummy && <span><i style={{ borderColor: "var(--dummy)" }} />dummy</span>}
      <span><i style={{ borderColor: "var(--ink-3)", borderTopStyle: "dashed" }} />baseline</span>
      <span><i style={{ borderColor: "var(--alarm)" }} />alarm</span>
      <span><i style={{ borderColor: "var(--crit)" }} />batas trip</span>
      {proj && <span><i style={{ borderColor: "var(--s2)", borderTopStyle: "dashed" }} />proyeksi</span>}
      {train && <span><i className="sq" style={{ background: "var(--band-train)", outline: "1px solid var(--good)" }} />data latih AI</span>}
    </span>
  );
}

function buildCharts(m: AssetMeta, hist: History | null, now: number, hours: number) {
  if (!hist || hist.assetId !== m.id) return null;
  const s1 = cssVar("--s1"), s2 = cssVar("--s2"), dm = cssVar("--dummy");
  const bands = outageBands(hist.h, hist.code);

  // ----- weekly condition monitoring: real readings in blue, DUMMY readings in purple
  const weekly = m.weekly.map((s, k) => {
    const pts = hist.cm;
    if (!pts.length) return null;
    const H = pts.map((p) => p.h);
    const lines: Line[] = [
      { name: s.name, h: H, v: pts.map((p) => (p.real ? p.v[k] : null)), color: s1, symbol: true },
      { name: "Isian dummy", h: H, v: pts.map((p) => (p.real ? null : p.v[k])), color: dm, symbol: true, width: 1.2 },
    ];
    const p = hist.cmPreds.find((x) => x.k === k);
    let x1 = Math.max(now, pts[pts.length - 1].h);
    if (p) {
      const pr = projection(p, p.h);
      lines.push({ name: "Proyeksi", h: pr.h, v: pr.v, color: s2, dashed: true });
      x1 = Math.max(x1, p.h);
    }
    const refs = limitRefs(s, hist.cmBase?.[k]);
    const all = lines.flatMap((l) => l.v);
    return timeChart({ lines, refs, bands, now, x0: pts[0].h, x1: x1 + 168, unit: s.unit, ...yRange(all, refs) });
  });

  // ----- hourly signals: split into real and DUMMY segments
  const isReal = (i: number) => hist.real[i] === 1;
  const split = (v: (number | null)[]) => [v.map((x, i) => (isReal(i) ? x : null)), v.map((x, i) => (isReal(i) ? null : x))];
  const preds = hist.hrPreds.filter((p) => !m.hourly[p.k].normBy);
  const x0 = Math.max(0, now - hours + 1);
  const x1 = now + (preds.length ? Math.round(hours * 0.3) : 0);
  const tr = hist.model.trainedRange;
  const hBands = [...bands, ...(tr && tr[1] >= x0 ? [{ from: tr[0], to: tr[1] + 1, color: cssVar("--band-train"), label: "data latih AI" }] : [])];
  const hourly = m.hourly.map((s, k) => {
    const [vr, vd] = split(hist.values[k]);
    const lines: Line[] = [
      { name: s.name, h: hist.h, v: vr, color: s1, width: 1.5 },
      { name: "Isian dummy", h: hist.h, v: vd, color: dm, width: 1.2 },
    ];
    const p = preds.find((x) => x.k === k);
    if (p) {
      const pr = projection(p, Math.min(p.h, x1));
      lines.push({ name: "Proyeksi", h: pr.h, v: pr.v, color: s2, dashed: true });
    }
    const refs = limitRefs(s, s.trip != null ? hist.hrBase?.[k] : null);
    return timeChart({ lines, refs, bands: hBands, now, x0, x1, unit: s.unit, ...yRange(lines.flatMap((l) => l.v), refs) });
  });

  // ----- AI score (log scale, floor at 0.01 so the axis stays valid)
  const hasRatio = hist.ratio.some((v) => v != null);
  const [rr, rd] = split(hist.ratio.map((v) => (v == null ? null : Math.max(v, 0.01))));
  const ai = hasRatio ? timeChart({
    lines: [{ name: "Skor AI (data asli)", h: hist.h, v: rr, color: s1, width: 1.5 }, { name: "Skor AI (isian dummy)", h: hist.h, v: rd, color: dm, width: 1.2 }],
    refs: [{ y: 1, label: "batas 1×", color: cssVar("--alarm") }, { y: 5, label: "5×", color: cssVar("--crit"), dashed: true }],
    bands: hBands, now, x0, x1: now, unit: "× batas", log: true,
  }) : null;

  const c = hist.contrib;
  const contrib = c ? (() => {
    const order = c.values.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
    return hBars({ labels: order.map(([, i]) => c.keys[i]), values: order.map(([v]) => v * 100), colors: order.map((_, j) => (j === 0 ? s2 : s1)), fmt: (v) => `${nf(v)}%`, left: 150 });
  })() : null;

  return { weekly, hourly, ai, contrib };
}
