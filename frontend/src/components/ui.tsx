import { ReactNode, useEffect, useRef, useState } from "react";
import { EventItem, fDT, Source, STATUS_LABEL } from "../api";

const ICON: Record<string, ReactNode> = {
  NORMAL: <svg viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>,
  NODATA: <svg viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.6" /></svg>,
  WATCH: <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1.2L9.2 8.8H.8Z" fill="currentColor" /></svg>,
  ALARM: <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 .8L9.2 5 5 9.2.8 5Z" fill="currentColor" /></svg>,
  CRITICAL: <svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.2" y="1.2" width="7.6" height="7.6" fill="currentColor" /></svg>,
  TRIP: <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>,
  MAINT: <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.8 5.2L4 7.4 8.4 2.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
  DATA: <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5h8" stroke="currentColor" strokeWidth="2" /><path d="M1 2h8M1 8h8" stroke="currentColor" strokeWidth="1" /></svg>,
  MODEL: <svg viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.4" /><circle cx="5" cy="5" r="1.4" fill="currentColor" /></svg>,
};
ICON.PULIH = ICON.MAINT;
const EVCOLOR: Record<string, string> = {
  WATCH: "var(--watch)", ALARM: "var(--alarm)", CRITICAL: "var(--crit)", TRIP: "var(--trip)", MAINT: "var(--good)", PULIH: "var(--good)",
  DATA: "var(--dummy)", MODEL: "var(--accent)", INFO: "var(--accent)",
};
export const evColor = (t: string) => EVCOLOR[t] ?? "var(--ink-3)";

export function StatusChip({ status }: { status: string }) {
  return <span className={`chip st-${status}`}>{ICON[status]}{STATUS_LABEL[status] ?? status}</span>;
}
export function Prio({ p }: { p?: string | null }) {
  return p && p !== "-" ? <span className={`prio ${p}`}>{p}</span> : <span className="prio none">–</span>;
}
export function Tag({ id }: { id: string }) { return <span className="tag">{id}</span>; }
export function SourceBadge({ source }: { source: Source }) {
  return source === "dummy" ? <span className="src dummy" title="Data dummy (simulasi), bukan data panitia">Dummy</span>
    : <span className="src real" title="Data asli dari panitia">Data panitia</span>;
}
export function Tile({ label, value, ctx, tone, icon, teal, hint }: { label: string; value: ReactNode; ctx?: ReactNode; tone?: "warn" | "good"; icon?: ReactNode; teal?: boolean; hint?: string }) {
  return (
    <div className={`tile${tone ? " " + tone : ""}`} title={hint}>
      {icon && <div className={`ico${teal ? " teal" : ""}`}>{icon}</div>}
      <div className="lbl">{label}</div><div className="val">{value}</div>{ctx && <div className="ctx">{ctx}</div>}
    </div>
  );
}
/** Small "i" badge; the explanation shows on hover (keeps panels free of long notes). */
export function Info({ text }: { text: string }) {
  return <span className="info" title={text} aria-label={text} role="img">i</span>;
}
export function Meter({ value, status }: { value: number | null; status: string }) {
  return <div className={`meter ${status}`}><span style={{ width: `${value ?? 0}%` }} /></div>;
}
export function Sparkline({ values, w = 90, h = 22 }: { values: (number | null)[]; w?: number; h?: number }) {
  const pts = values.map((v, i) => [i, v] as const).filter(([, v]) => v != null) as [number, number][];
  if (pts.length < 2) return <svg width={w} height={h} aria-hidden="true" />;
  const n = values.length - 1 || 1;
  const X = (i: number) => (i / n) * (w - 4) + 2, Y = (v: number) => h - 2 - (v / 100) * (h - 4);
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  const [li, lv] = pts[pts.length - 1];
  return (
    <svg width={w} height={h} role="img" aria-label="Tren health 14 hari">
      <path d={d} fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={X(li)} cy={Y(lv)} r="2.6" fill="var(--s1)" />
    </svg>
  );
}
export function EventRow({ e, onClick, showAsset = true }: { e: EventItem; onClick?: () => void; showAsset?: boolean }) {
  const st = e.type === "PULIH" ? "PULIH" : e.type;
  return (
    <button className="ev" onClick={onClick}>
      <span className="dot" style={{ color: evColor(e.type) }}>{ICON[st] ?? ICON.NORMAL}</span>
      <div>
        <div className="when">{fDT(e.h)}{showAsset && e.assetId ? ` · ${e.assetId}` : ""}</div>
        <div className="what"><b>{STATUS_LABEL[e.type] ?? e.type}</b> {e.prio && e.prio !== "-" && <Prio p={e.prio} />} {e.text}</div>
      </div>
    </button>
  );
}
export function Panel({ title, sub, right, children, id }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="panel" id={id}>
      <div className="panel-h"><h3>{title}</h3>{sub && <span className="sub">{sub}</span>}{right}</div>
      {children}
    </section>
  );
}
export const PlayIcon = () => <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 2l9 5-9 5z" fill="currentColor" /></svg>;
export const PauseIcon = () => <svg viewBox="0 0 14 14" aria-hidden="true"><rect x="3" y="2" width="3" height="10" fill="currentColor" /><rect x="8" y="2" width="3" height="10" fill="currentColor" /></svg>;
export const BackIcon = () => <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2L2 7l5 5zM12 2L7 7l5 5z" fill="currentColor" /></svg>;
export const FwdIcon = () => <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l5 5-5 5zM7 2l5 5-5 5z" fill="currentColor" /></svg>;

// Minimal, safe markdown for Claude's answers: headings, bold, bullets, numbered lists.
export function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let list: { kind: "ul" | "ol"; items: ReactNode[] } | null = null;
  const inline = (s: string, k: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <b key={k + i}>{p.slice(2, -2)}</b> : p));
  const flush = () => {
    if (!list) return;
    const L = list;
    out.push(L.kind === "ul" ? <ul key={out.length}>{L.items}</ul> : <ol key={out.length}>{L.items}</ol>);
    list = null;
  };
  text.split(/\r?\n/).forEach((raw, i) => {
    const l = raw.trim();
    let m: RegExpMatchArray | null;
    if (!l) { flush(); return; }
    if ((m = l.match(/^#{1,4}\s+(.*)$/))) { flush(); out.push(<h4 key={i}>{inline(m[1], `h${i}`)}</h4>); return; }
    if ((m = l.match(/^[-*•]\s+(.*)$/))) { if (!list || list.kind !== "ul") { flush(); list = { kind: "ul", items: [] }; } list.items.push(<li key={i}>{inline(m[1], `l${i}`)}</li>); return; }
    if ((m = l.match(/^\d+[.)]\s+(.*)$/))) { if (!list || list.kind !== "ol") { flush(); list = { kind: "ol", items: [] }; } list.items.push(<li key={i}>{inline(m[1], `o${i}`)}</li>); return; }
    flush();
    out.push(<p key={i}>{inline(l, `p${i}`)}</p>);
  });
  flush();
  return <>{out}</>;
}

/** A number that eases to its new value in about half a second, so live changes are noticeable without distracting. */
export function Num({ value, fmt }: { value: number | null | undefined; fmt: (v: number) => string }) {
  const [shown, setShown] = useState<number | null>(value ?? null);
  const cur = useRef<number | null>(value ?? null);
  useEffect(() => {
    if (value == null) { cur.current = null; setShown(null); return; }
    const a = cur.current;
    if (a == null || a === value || matchMedia("(prefers-reduced-motion: reduce)").matches) { cur.current = value; setShown(value); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 500), e = 1 - (1 - k) ** 3;
      cur.current = a + (value - a) * e;
      setShown(cur.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown == null ? "–" : fmt(shown)}</>;
}
