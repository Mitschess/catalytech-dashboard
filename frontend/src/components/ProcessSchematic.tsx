import { KeyboardEvent, MouseEvent, useRef, useState } from "react";
import { AssetState, fDs, nf, STATUS_LABEL } from "../api";
import { useLive } from "../live";
import { Prio, StatusChip } from "./ui";

/*
 * Illustrative site schematic (not a P&ID): the five monitored assets in the usual order of a petrochemical site.
 * ISA-101 style: grey while normal, colour only for abnormal states; rotating parts and pipe flow move only while
 * the machine that drives them is running, and stop on a trip or planned intervention.
 */

type Kind = "pump" | "compressor" | "blower" | "exchanger";
const EQUIP: { id: string; kind: Kind; x: number; y: number }[] = [
  { id: "HE-3301", kind: "exchanger", x: 150, y: 140 },
  { id: "KO-3201", kind: "compressor", x: 492, y: 140 },
  { id: "BL-5702", kind: "blower", x: 962, y: 88 },
  { id: "PU-2101B", kind: "pump", x: 860, y: 262 },
  { id: "PM-4405B", kind: "pump", x: 210, y: 306 },
];
// Plain process blocks that are not monitored.
const BLOCKS: { x: number; y: number; w: number; h: number; label: string }[] = [
  { x: 244, y: 118, w: 78, h: 44, label: "Furnace" },
  { x: 356, y: 118, w: 72, h: 44, label: "Quench" },
  { x: 568, y: 96, w: 56, h: 88, label: "Separasi" },
  { x: 728, y: 66, w: 72, h: 44, label: "Reaktor" },
  { x: 834, y: 66, w: 64, h: 44, label: "Dryer" },
  { x: 1056, y: 60, w: 58, h: 56, label: "Silo" },
  { x: 730, y: 240, w: 62, h: 44, label: "Tangki" },
  { x: 952, y: 240, w: 72, h: 44, label: "Reaktor" },
];
const UNITS: { x: number; y: number; w: number; h: number; code: string; name: string }[] = [
  { x: 24, y: 70, w: 636, h: 150, code: "ZCU", name: "Cracker Unit" },
  { x: 700, y: 22, w: 456, h: 136, code: "OPP", name: "Polymer Plant" },
  { x: 700, y: 184, w: 456, h: 150, code: "ARP", name: "Resin Plant" },
  { x: 24, y: 256, w: 636, h: 116, code: "NUP", name: "Utility Plant" },
];
// Pipes; `by` = the monitored machine whose outage stops the flow in that pipe.
const PIPES: { d: string; by?: string }[] = [
  { d: "M40 140 H114", by: "HE-3301" },
  { d: "M186 140 H244", by: "HE-3301" },
  { d: "M322 140 H356" },
  { d: "M428 140 H462", by: "KO-3201" },
  { d: "M522 140 H568", by: "KO-3201" },
  { d: "M624 120 H682 V88 H728", by: "KO-3201" },
  { d: "M624 160 H682 V262 H730", by: "KO-3201" },
  { d: "M800 88 H834" },
  { d: "M898 88 H938", by: "BL-5702" },
  { d: "M986 88 H1056", by: "BL-5702" },
  { d: "M792 262 H838", by: "PU-2101B" },
  { d: "M882 262 H952", by: "PU-2101B" },
  { d: "M1024 262 H1140", by: undefined },
  { d: "M232 306 H640", by: "PM-4405B" },
  { d: "M392 306 V162", by: "PM-4405B" },
];
const LABELS: { x: number; y: number; t: string; anchor?: "start" | "end" }[] = [
  { x: 40, y: 130, t: "Umpan" },
  { x: 1140, y: 252, t: "Resin", anchor: "end" },
  { x: 420, y: 298, t: "header air pendingin → pendingin proses" },
];

const running = (s?: AssetState) => !!s && s.status !== "TRIP" && s.status !== "MAINT" && s.status !== "NODATA";

function Symbol({ kind }: { kind: Kind }) {
  if (kind === "exchanger") {
    return (
      <>
        <rect className="body" x={-36} y={-16} width={72} height={32} rx={16} />
        <path className="tube" d="M-26 0 l7-8 l7 16 l7-16 l7 16 l7-16 l7 16 l7-8" />
      </>
    );
  }
  if (kind === "compressor") {
    return (
      <>
        <path className="body" d="M-30 -24 L30 -12 L30 12 L-30 24 Z" />
        <g className="rot fast"><path className="blade" d="M0 -9 L2 0 L0 9 L-2 0 Z M-9 0 L0 -2 L9 0 L0 2 Z" /></g>
      </>
    );
  }
  if (kind === "blower") {
    return (
      <>
        <rect className="body" x={10} y={-26} width={16} height={12} />
        <circle className="body" r={22} />
        <g className="rot slow">
          {[0, 90, 180, 270].map((a) => <path key={a} className="blade" transform={`rotate(${a})`} d="M0 0 C4 -6 12 -8 16 -4 C10 -2 5 0 0 0 Z" />)}
        </g>
      </>
    );
  }
  return (
    <>
      <rect className="body" x={6} y={-24} width={14} height={10} />
      <circle className="body" r={20} />
      <g className="rot">
        {[0, 120, 240].map((a) => <path key={a} className="blade" transform={`rotate(${a})`} d="M0 0 C3 -5 9 -9 14 -6 C8 -4 4 -1 0 0 Z" />)}
      </g>
    </>
  );
}

export function ProcessSchematic({ onOpen }: { onOpen: (id: string) => void }) {
  const { snap, assetMeta } = useLive();
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const byId = new Map(snap!.assets.map((a) => [a.id, a]));
  const unacked = new Set(snap!.alerts.filter((a) => a.open && !a.ack && a.level === 3).map((a) => a.assetId));

  const place = (id: string, e: MouseEvent | KeyboardEvent | null, el?: Element) => {
    const w = wrap.current!, box = w.getBoundingClientRect();
    const px = e && "clientX" in e ? e.clientX : el ? el.getBoundingClientRect().right : 0;
    const py = e && "clientY" in e ? e.clientY : el ? el.getBoundingClientRect().top : 0;
    // Keep the 280px tooltip inside the visible part of the diagram.
    const x = Math.min(px - box.left + 14, box.width - 296) + w.scrollLeft;
    setTip({ id, x: Math.max(w.scrollLeft + 4, x), y: Math.max(4, py - box.top - 10) });
  };
  const ts = tip ? byId.get(tip.id) : undefined;
  const tm = tip ? assetMeta(tip.id) : undefined;

  return (
    <div className="schem-wrap" ref={wrap} onMouseLeave={() => setTip(null)}>
      <svg className="schem" viewBox="0 0 1180 380" role="group" aria-label="Skematik proses site dengan status lima aset yang dipantau">
        {UNITS.map((u) => (
          <g key={u.code} className="unitbox">
            <rect x={u.x} y={u.y} width={u.w} height={u.h} rx={10} />
            <text x={u.x + 12} y={u.y + 18}><tspan className="uc">{u.code}</tspan> · {u.name}</text>
          </g>
        ))}
        {PIPES.map((p, i) => {
          const on = !p.by || running(byId.get(p.by));
          return (
            <g key={i} className={`pipe${on ? " on" : ""}`}>
              <path className="pipe-base" d={p.d} />
              <path className="pipe-flow" d={p.d} />
            </g>
          );
        })}
        {LABELS.map((l) => <text key={l.t} className="plabel" x={l.x} y={l.y} textAnchor={l.anchor ?? "start"}>{l.t}</text>)}
        {BLOCKS.map((b, i) => (
          <g key={i} className="block">
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={5} />
            <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 4} textAnchor="middle">{b.label}</text>
          </g>
        ))}
        {EQUIP.map((q) => {
          const s = byId.get(q.id);
          const st = s?.status ?? "NODATA";
          const label = s?.health != null ? `${s.health}` : "–";
          return (
            <g key={q.id} className={`eq st-${st}${running(s) ? "" : " stopped"}`} transform={`translate(${q.x} ${q.y})`} tabIndex={0} role="button"
              aria-label={`${q.id}, ${STATUS_LABEL[st]}, health ${label}. Buka monitor aset.`}
              onClick={() => onOpen(q.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(q.id); } }}
              onMouseMove={(e) => place(q.id, e)} onFocus={(e) => place(q.id, null, e.currentTarget)} onBlur={() => setTip(null)}>
              <circle className="hit" r={40} />
              {unacked.has(q.id) && <circle className="ring" r={34} />}
              <Symbol kind={q.kind} />
              {st === "TRIP" && <path className="x" d="M-14 -14 L14 14 M14 -14 L-14 14" />}
              <text className="tag" y={q.kind === "exchanger" ? 34 : 42} textAnchor="middle">{q.id}</text>
              <text className="hv" y={q.kind === "exchanger" ? 49 : 57} textAnchor="middle">{st === "TRIP" ? "TRIP" : st === "MAINT" ? "intervensi" : `health ${label}`}{s && s.prio !== "-" ? ` · ${s.prio}` : ""}</text>
            </g>
          );
        })}
      </svg>
      {tip && ts && tm && (
        <div className="schem-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
          <div className="row" style={{ gap: 6, marginBottom: 4 }}><b className="mono">{tm.id}</b><span className="muted small">{tm.short}</span></div>
          <div className="row" style={{ gap: 6, marginBottom: 4 }}><StatusChip status={ts.status} /><Prio p={ts.prio} /><span className="small">health <b>{ts.health ?? "–"}</b></span></div>
          {ts.reason && <div className="small" style={{ marginBottom: 4 }}>{ts.reason}</div>}
          <div className="xs muted">
            {ts.mspc.ratio != null ? `Skor AI ${nf(ts.mspc.ratio, 2)}× batas · ` : ""}{ts.predH != null ? `prediksi trip ${fDs(ts.predH)} · ` : ""}
            data per jam: {ts.realNow ? "PI asli" : "isian DUMMY"}
          </div>
          <div className="xs" style={{ color: "var(--accent)", marginTop: 4 }}>Klik untuk membuka monitor aset</div>
        </div>
      )}
    </div>
  );
}
