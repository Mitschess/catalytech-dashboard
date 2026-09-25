import { useEffect, useMemo, useRef, useState } from "react";
import { AssetState, cssVar, fDs, nf, STATUS_RANK, UNIT_ORDER, usd } from "../api";
import { useLive } from "../live";
import type { Page } from "../App";
import { EChart } from "../components/EChart";
import { hBars, vBars } from "../charts";
import { ProcessSchematic } from "../components/ProcessSchematic";
import { EventRow, Meter, Num, Panel, Prio, Sparkline, StatusChip, Tag, Tile } from "../components/ui";

type Order = "risk" | "unit";

export default function Overview({ go }: { go: (p: Page, a?: string | null) => void }) {
  const { meta, snap } = useLive();
  const [order, setOrder] = useState<Order>("risk");
  const k = snap!.kpis;
  const inc = meta!.incidents;
  const assets = useMemo(() => [...snap!.assets].sort(order === "risk"
    ? (x, y) => STATUS_RANK[y.status] - STATUS_RANK[x.status] || (x.prio === "-" ? 9 : +x.prio[1]) - (y.prio === "-" ? 9 : +y.prio[1]) || x.id.localeCompare(y.id)
    : (x, y) => UNIT_ORDER.indexOf(meta!.assets.find((a) => a.id === x.id)!.plantCode) - UNIT_ORDER.indexOf(meta!.assets.find((a) => a.id === y.id)!.plantCode)),
  [snap, order, meta]);
  const events = useMemo(() => [...snap!.events].filter((e) => e.type !== "MODEL").reverse().slice(0, 60), [snap]);
  const open = k.alerts.P1 + k.alerts.P2 + k.alerts.P3;
  const l = k.losses;
  const nReal = snap!.assets.filter((a) => a.realNow).length;

  const monthly = useMemo(() => {
    const labels = inc.byMonth.map((m) => { const [y, mo] = m.k.split("-"); return `${["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"][+mo - 1]} ${y.slice(2)}`; });
    const vals = inc.byMonth.map((m) => m.v / 1000);
    const ma = vals.map((_, i) => (i >= 2 ? (vals[i] + vals[i - 1] + vals[i - 2]) / 3 : null));
    return vBars({ labels, values: vals, line: ma, lineName: "Rata-rata 3 bulan", fmt: (v) => `US$${nf(v, 2)} jt` });
  }, [inc]);
  const pareto = useMemo(() => {
    const top = inc.byMechanism.slice(0, 8);
    const s2 = cssVar("--s2"), s1 = cssVar("--s1");
    return hBars({ labels: top.map((x) => x.k), values: top.map((x) => x.v), colors: top.map((_, i) => (i < 3 ? s2 : s1)), fmt: (v) => usd(v), left: 112 });
  }, [inc]);

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Single pane of glass</div><h1>Plant overview</h1>
          <p>Kondisi lima aset kritis dari data panitia pada waktu simulasi. Tekan putar di bilah atas: data mengalir per jam, AI menilai setiap jam,
            dan skematik berubah warna saat ada kondisi tidak normal.</p></div>
      </div>
      <div className="tiles">
        <Tile label="Aset dipantau" value={k.assets} ctx={`data per jam kini: ${nReal} PI asli, ${k.assets - nReal} isian dummy · ${k.models.ready} model AI aktif`} />
        <Tile label="Alert terbuka" value={<Num value={open} fmt={(v) => nf(v)} />} ctx={`P1 ${k.alerts.P1} · P2 ${k.alerts.P2} · P3 ${k.alerts.P3}`} tone={k.alerts.P1 ? "warn" : undefined} />
        <Tile label="Nilai risiko terbuka" value={<Num value={k.varUsd} fmt={usd} />} ctx="Σ P(gagal) × kerugian jika trip" />
        <Tile label="SLA terlewat" value={k.overdue} ctx="alert tanpa tindakan melewati tenggat" tone={k.overdue ? "warn" : undefined} />
        <Tile label="Kerugian s/d kini" value={<Num value={snap!.mode === "reality" ? l.realityNow : l.scenarioNow} fmt={usd} />} ctx={`kenyataan s/d kini ${usd(l.realityNow)}`} />
        <Tile label="Kerugian terhindar (proyeksi)" value={<Num value={l.realityEnd - l.scenarioEnd} fmt={usd} />} tone={l.realityEnd - l.scenarioEnd > 0 ? "good" : undefined}
          ctx={snap!.mode === "reality" ? "pilih mode SIGAP otomatis / Manual" : `dari total ${usd(l.realityEnd)} bila tanpa tindakan`} />
      </div>

      <Panel title="Skematik proses site" sub="ilustratif, bukan P&ID · gerak = mesin beroperasi · warna = kondisi tidak normal · klik aset untuk detail">
        <ProcessSchematic onOpen={(id) => go("monitor", id)} />
        <div className="legend">
          <span><i className="sq" style={{ background: "var(--surface)", outline: "1.5px solid var(--ink-2)" }} />normal</span>
          <span><i className="sq" style={{ background: "var(--watch)" }} />watch</span>
          <span><i className="sq" style={{ background: "var(--alarm)" }} />alarm</span>
          <span><i className="sq" style={{ background: "var(--crit)" }} />critical (cincin berdenyut = P1 belum di-acknowledge)</span>
          <span><i className="sq" style={{ background: "var(--trip)" }} />trip, aliran berhenti</span>
          <span><i className="sq" style={{ background: "var(--good)" }} />intervensi / pulih</span>
        </div>
      </Panel>

      <div style={{ height: 14 }} />
      <div className="ov">
        <div>
          <div className="row" style={{ marginBottom: 8 }}>
            <h3 style={{ fontSize: 17 }}>Status aset</h3><span className="sp" />
            <div className="seg" role="group" aria-label="Urutan kartu">
              <button aria-pressed={order === "risk"} onClick={() => setOrder("risk")}>Paling berisiko</button>
              <button aria-pressed={order === "unit"} onClick={() => setOrder("unit")}>Per unit</button>
            </div>
          </div>
          <div className="cards">{assets.map((s) => <AssetCard key={s.id} s={s} onOpen={() => go("monitor", s.id)} />)}</div>
        </div>
        <Panel title="Log kejadian live" sub={`${events.length} terbaru`}>
          <div className="feed">
            {events.length ? events.map((e) => <EventRow key={`${e.h}-${e.assetId}-${e.type}`} e={e} onClick={() => go("monitor", e.assetId)} />)
              : <div className="empty">Belum ada kejadian. Tekan putar di bilah atas.</div>}
          </div>
        </Panel>
      </div>

      <h2 style={{ fontSize: 20, margin: "22px 0 10px" }}>Konteks historis <span className="src real" style={{ verticalAlign: "middle" }}>Data panitia</span></h2>
      <div className="tiles t4">
        <Tile label="Insiden Jan 2024 - Jul 2026" value={nf(inc.n)} ctx={`${nf(inc.downtime)} jam downtime`} />
        <Tile label="Total kerugian" value={usd(inc.totalLoss)} ctx={`${usd(inc.openLoss)} masih terbuka (${inc.openN} insiden)`} />
        <Tile label="RCA lewat tenggat" value={`${inc.rcaOverdue}/${inc.rcaStage}`} ctx={`median ${nf(inc.overdueMedianDays)} hari terlambat`} tone="warn" />
        <Tile label="Korelasi Risk Score vs loss" value={`ρ ${nf(inc.spearman, 2)}`} ctx="skor lama tidak memprediksi kerugian" tone="warn" />
      </div>
      <div className="grid g2">
        <Panel title="Kerugian bulanan" sub="juta US$ · garis = rata-rata 3 bulan"><EChart option={monthly} height={230} label="Kerugian bulanan dari incident database" /></Panel>
        <Panel title="Mekanisme kegagalan teratas" sub="3 teratas berwarna oranye"><EChart option={pareto} height={230} label="Pareto kerugian per mekanisme" /></Panel>
      </div>
    </>
  );
}

function AssetCard({ s, onOpen }: { s: AssetState; onOpen: () => void }) {
  const { assetMeta } = useLive();
  const m = assetMeta(s.id)!;
  // Brief highlight when the status changes, so a change is noticed without constant motion.
  const prev = useRef(s.status);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prev.current === s.status) return;
    prev.current = s.status;
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 1400);
    return () => clearTimeout(t);
  }, [s.status]);
  const foot = s.status === "TRIP" ? "Trip tidak terencana" : s.status === "MAINT" ? "Intervensi terencana berjalan"
    : s.predH ? `Prediksi batas trip ${fDs(s.predH)}` : s.mspc.state === "training" ? `Model AI belajar ${nf(s.mspc.progress * 100)}%`
      : s.mspc.ratio != null ? `Skor AI ${nf(s.mspc.ratio, 2)}× batas` : "Model AI menunggu data";
  return (
    <button className={`acard${flash ? " flash" : ""}`} onClick={onOpen}>
      <div className="r1"><Tag id={s.id} />{s.realNow ? <span className="src real" title="Jam ini berasal dari data PI panitia">PI asli</span>
        : <span className="src dummy" title="Jam ini isian dummy: pola operasi normal buatan dari hari-hari normal aset ini">Isian dummy</span>}</div>
      <div className="nm">{m.short} · {m.plantCode} · Class {m.cls}</div>
      <div className="r1"><span className="hnum"><Num value={s.health} fmt={(v) => nf(v)} /></span><div style={{ flex: 1 }}><Meter value={s.health} status={s.status} /></div><Sparkline values={s.healthTrend} w={64} /></div>
      <div className="r1"><StatusChip status={s.status} /><Prio p={s.prio} /></div>
      <div className="why">{s.reason || (s.dq ? `Sensor ${s.dq.join(", ")} bermasalah (flatline).` : s.status === "NODATA" ? "Belum ada data kondisi." : "Semua parameter dalam pola normal.")}</div>
      <div className="r3"><span>{foot}</span>{s.scheduledH != null && s.status !== "MAINT" && <span style={{ color: "var(--good)" }}>intervensi {fDs(s.scheduledH)}</span>}</div>
    </button>
  );
}
