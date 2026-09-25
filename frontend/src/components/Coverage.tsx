import { AssetMeta, fD, UNIT_ORDER } from "../api";

const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** One row per asset across the whole simulated timeline: where real data exists and where the DUMMY fill is used. */
export function Coverage({ assets, nHours, now, simStart, onOpen }: { assets: AssetMeta[]; nHours: number; now: number; simStart: string; onOpen: (id: string) => void }) {
  const pct = (h: number) => `${(Math.max(0, Math.min(h, nHours)) / nHours) * 100}%`;
  const span = (a: number, b: number) => ({ left: pct(a), width: `${((Math.min(b, nHours) - Math.max(a, 0)) / nHours) * 100}%` });
  // Month ticks: first hour of each calendar month inside the timeline.
  const start = new Date(simStart + "Z");
  const ticks: { h: number; label: string }[] = [];
  for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)); ; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const h = Math.round((d.getTime() - start.getTime()) / 3600e3);
    if (h >= nHours) break;
    ticks.push({ h, label: `${MON[d.getUTCMonth()]}${d.getUTCMonth() === 0 ? ` ${String(d.getUTCFullYear()).slice(2)}` : ""}` });
  }
  const rows = [...assets].sort((a, b) => UNIT_ORDER.indexOf(a.plantCode) - UNIT_ORDER.indexOf(b.plantCode));

  return (
    <>
    <div className="cov-scroll"><div className="cov">
      {rows.map((a) => (
        <div className="cov-row" key={a.id}>
          <button className="cov-l" onClick={() => onOpen(a.id)} title="Buka monitor aset"><span className="mono">{a.id}</span><span>{a.plantCode}</span></button>
          <div className="cov-track">
            <span className="cov-dummy" title="Isian dummy: pola operasi normal buatan" />
            {a.weeklyWindow && <span className="cov-cm" style={span(a.weeklyWindow[0], a.weeklyWindow[1] + 168)} title={`Condition monitoring mingguan asli ${fD(a.weeklyWindow[0])} – ${fD(a.weeklyWindow[1])}`} />}
            {a.hourlyWindow && <span className="cov-pi" style={span(a.hourlyWindow[0], a.hourlyWindow[1] + 1)} title={`Data PI per jam asli ${fD(a.hourlyWindow[0])} – ${fD(a.hourlyWindow[1])}`} />}
            {a.tripStart != null && <span className="cov-trip" style={{ left: pct(a.tripStart) }} title={`Trip ${fD(a.tripStart)}`}>✕</span>}
          </div>
        </div>
      ))}
      <div className="cov-row cov-axis">
        <span />
        <div className="cov-track bare">
          {ticks.map((t) => <span key={t.h} className="cov-tick" style={{ left: pct(t.h) }}>{t.label}</span>)}
        </div>
      </div>
      <span className="cov-now" style={{ left: `calc(120px + (100% - 120px) * ${Math.max(0, Math.min(now, nHours)) / nHours})` }} title={`Waktu simulasi ${fD(now)}`} />
    </div></div>
      <div className="legend">
        <span><i className="sq" style={{ background: "var(--s1)" }} />data PI per jam asli (30 hari)</span>
        <span><i className="sq" style={{ background: "var(--accent-soft)", outline: "1px solid var(--accent)" }} />condition monitoring mingguan asli</span>
        <span><i className="sq cov-dummy-sw" />isian dummy</span>
        <span><b style={{ color: "var(--crit)" }}>✕</b> trip nyata</span>
        <span><i style={{ borderColor: "var(--ink)", width: 0, height: 12, borderTop: 0, borderLeft: "2px solid" }} />waktu simulasi</span>
      </div>
    </>
  );
}
