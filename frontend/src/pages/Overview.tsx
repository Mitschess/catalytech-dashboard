import { useEffect, useMemo, useRef, useState } from "react";
import { AssetState, cssVar, fDs, nf, STATUS_RANK, usd } from "../api";
import { useLive } from "../live";
import type { Page } from "../App";
import { EChart } from "../components/EChart";
import { hBars, vBars } from "../charts";
import { ProcessSchematic } from "../components/ProcessSchematic";
import { Kpi } from "../components/icons";
import { EventRow, Info, Meter, Num, Panel, Prio, Sparkline, StatusChip, Tag, Tile } from "../components/ui";

export default function Overview({ go }: { go: (p: Page, a?: string | null) => void }) {
  const { meta, snap } = useLive();
  const k = snap!.kpis;
  const inc = meta!.incidents;
  const assets = useMemo(() => [...snap!.assets].sort((x, y) => STATUS_RANK[y.status] - STATUS_RANK[x.status]
    || (x.prio === "-" ? 9 : +x.prio[1]) - (y.prio === "-" ? 9 : +y.prio[1]) || x.id.localeCompare(y.id)), [snap]);
  const events = useMemo(() => [...snap!.events].filter((e) => e.type !== "MODEL").reverse().slice(0, 60), [snap]);
  const open = k.alerts.P1 + k.alerts.P2 + k.alerts.P3;
  const l = k.losses;
  const saved = l.realityEnd - l.scenarioEnd;

  const monthly = useMemo(() => {
    const labels = inc.byMonth.map((m) => { const [y, mo] = m.k.split("-"); return `${["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"][+mo - 1]} ${y.slice(2)}`; });
    const vals = inc.byMonth.map((m) => m.v / 1000);
    const ma = vals.map((_, i) => (i >= 2 ? (vals[i] + vals[i - 1] + vals[i - 2]) / 3 : null));
    return vBars({ labels, values: vals, line: ma, lineName: "Rata-rata 3 bulan", fmt: (v) => `US$${nf(v, 2)} jt` });
  }, [inc]);
  const pareto = useMemo(() => {
    const top = inc.byMechanism.slice(0, 7);
    const s2 = cssVar("--s2"), s1 = cssVar("--s1");
    return hBars({ labels: top.map((x) => x.k), values: top.map((x) => x.v), colors: top.map((_, i) => (i < 3 ? s2 : s1)), fmt: (v) => usd(v), left: 106 });
  }, [inc]);

  return (
    <>
      <div className="tiles">
        <Tile icon={<Kpi.asset />} label="Aset dipantau" value={k.assets} ctx={`${k.models.ready} model AI aktif`} />
        <Tile icon={<Kpi.alert />} label="Alert terbuka" value={<Num value={open} fmt={(v) => nf(v)} />} ctx={`P1 ${k.alerts.P1} · P2 ${k.alerts.P2} · P3 ${k.alerts.P3}`} tone={k.alerts.P1 ? "warn" : undefined} />
        <Tile icon={<Kpi.risk />} label="Nilai risiko" value={<Num value={k.varUsd} fmt={usd} />} ctx="P(gagal) × kerugian trip" />
        <Tile icon={<Kpi.clock />} label="SLA terlewat" value={k.overdue} ctx="alert belum ditindak" tone={k.overdue ? "warn" : undefined} />
        <Tile icon={<Kpi.loss />} teal label="Kerugian s/d kini" value={<Num value={snap!.mode === "reality" ? l.realityNow : l.scenarioNow} fmt={usd} />} ctx={`total ${usd(l.realityEnd)} bila dibiarkan`} />
        <Tile icon={<Kpi.saved />} teal label="Kerugian terhindar" value={<Num value={saved} fmt={usd} />} tone={saved > 0 ? "good" : undefined}
          ctx={snap!.mode === "reality" ? "pilih Otomatis / Manual" : "proyeksi skenario ini"} />
      </div>

      <div className="ov">
        <Panel title={<>Skematik proses <Info text="Ilustratif, bukan P&ID. Pompa/kompresor/blower berputar saat beroperasi dan berhenti saat trip. Biru/teal = normal; kuning, oranye, merah = tidak normal. Cincin berdenyut = P1 belum di-acknowledge. Klik aset untuk detail." /></>}
          sub={<span className="legend" style={{ marginTop: 0 }}>
            <span><i className="sq" style={{ background: "var(--accent)" }} />normal</span><span><i className="sq" style={{ background: "var(--watch)" }} />watch</span>
            <span><i className="sq" style={{ background: "var(--alarm)" }} />alarm</span><span><i className="sq" style={{ background: "var(--crit)" }} />critical</span>
            <span><i className="sq" style={{ background: "var(--good)" }} />intervensi</span></span>}>
          <ProcessSchematic onOpen={(id) => go("monitor", id)} />
        </Panel>
        <Panel title="Kejadian live" sub={`${events.length}`}>
          <div className="feed fill">
            {events.length ? events.map((e) => <EventRow key={`${e.h}-${e.assetId}-${e.type}`} e={e} onClick={() => go("monitor", e.assetId)} />)
              : <div className="empty">Tekan ▶ di bilah atas.</div>}
          </div>
        </Panel>
      </div>

      <div className="gap" />
      <div className="cards">{assets.map((s) => <AssetCard key={s.id} s={s} onOpen={() => go("monitor", s.id)} />)}</div>

      <div className="gap" />
      <div className="tiles t4">
        <Tile icon={<Kpi.list />} label="Insiden 2024–2026" value={nf(inc.n)} ctx={`${usd(inc.totalLoss)} total kerugian`} />
        <Tile icon={<Kpi.risk />} label="Kerugian masih terbuka" value={usd(inc.openLoss)} ctx={`${inc.openN} insiden`} />
        <Tile icon={<Kpi.clock />} label="RCA lewat tenggat" value={`${inc.rcaOverdue}/${inc.rcaStage}`} ctx={`median ${nf(inc.overdueMedianDays)} hari`} tone="warn" />
        <Tile icon={<Kpi.chart />} label="Skor risiko lama vs kerugian" value={`ρ ${nf(inc.spearman, 2)}`} ctx="tidak berkorelasi" tone="warn"
          hint="Korelasi Spearman antara Risk Score lama dan kerugian nyata di Incident Database" />
      </div>
      <div className="grid g2">
        <Panel title="Kerugian bulanan" sub="juta US$ · garis = rata-rata 3 bulan"><EChart option={monthly} height={200} label="Kerugian bulanan dari incident database" /></Panel>
        <Panel title="Mekanisme kegagalan teratas" sub="Incident Database"><EChart option={pareto} height={200} label="Pareto kerugian per mekanisme" /></Panel>
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
  const foot = s.status === "TRIP" ? "Trip tidak terencana" : s.status === "MAINT" ? "Intervensi berjalan"
    : s.predH ? `Prediksi trip ${fDs(s.predH)}` : s.scheduledH != null ? `Intervensi ${fDs(s.scheduledH)}`
      : s.mspc.ratio != null ? `Skor AI ${nf(s.mspc.ratio, 2)}×` : "Model AI belajar";
  return (
    <button className={`acard st-b-${s.status}${flash ? " flash" : ""}`} onClick={onOpen}>
      <div className="r1"><Tag id={s.id} />{s.realNow ? <span className="src real" title="Jam ini dari data PI panitia">PI asli</span>
        : <span className="src dummy" title="Jam ini isian dummy (pola normal buatan dari hari normal aset ini)">Dummy</span>}</div>
      <div className="nm">{m.short} · {m.plantCode}</div>
      <div className="r1"><span className="hnum"><Num value={s.health} fmt={(v) => nf(v)} /></span><div style={{ flex: 1 }}><Meter value={s.health} status={s.status} /></div><Sparkline values={s.healthTrend} w={54} /></div>
      <div className="r1"><StatusChip status={s.status} /><Prio p={s.prio} /></div>
      <div className="why">{s.reason || (s.dq ? `Sensor ${s.dq.join(", ")} flatline.` : "Semua parameter normal.")}</div>
      <div className="r3">{foot}</div>
    </button>
  );
}
