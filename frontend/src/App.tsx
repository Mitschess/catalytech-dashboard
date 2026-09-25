import { useEffect, useMemo, useState } from "react";
import { fD, fHour, MODE_LABEL, Mode, STATUS_LABEL, UNIT_ORDER, usd } from "./api";
import { useLive } from "./live";
import { BackIcon, evColor, FwdIcon, PauseIcon, PlayIcon } from "./components/ui";
import { CollapseIcon, MenuIcon, PageIcon } from "./components/icons";
import Overview from "./pages/Overview";
import Monitor from "./pages/Monitor";
import ActionHub from "./pages/ActionHub";
import Rca from "./pages/Rca";
import Models from "./pages/Models";
import DataPage from "./pages/DataPage";

export type Page = "overview" | "monitor" | "alerts" | "rca" | "models" | "data";
const PAGES: [Page, string][] = [["overview", "Plant overview"], ["monitor", "Monitor aset"], ["alerts", "Action Hub"], ["rca", "AI RCA Assistant"], ["models", "Model AI"], ["data", "Data & sumber"]];

function parseHash(): { page: Page; asset: string | null } {
  const [p, a] = location.hash.replace("#", "").split("/");
  const page = (PAGES.find(([k]) => k === p)?.[0] ?? "overview") as Page;
  return { page, asset: a ? decodeURIComponent(a) : null };
}
function loadCollapsed(): boolean {
  try { return localStorage.getItem("sigap.side") === "min"; } catch { return false; }
}

export default function App() {
  const { meta, snap, conn, toasts, dismiss } = useLive();
  const [route, setRoute] = useState(parseHash);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    const on = () => { setRoute(parseHash()); setDrawer(false); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const toggle = () => setCollapsed((c) => {
    try { localStorage.setItem("sigap.side", c ? "full" : "min"); } catch { /* keep in memory only */ }
    return !c;
  });
  const go = (page: Page, asset?: string | null) => {
    const a = asset ?? (page === "monitor" || page === "rca" ? route.asset : null);
    location.hash = a ? `${page}/${encodeURIComponent(a)}` : page;
    window.scrollTo({ top: 0 });
  };
  const title = PAGES.find(([k]) => k === route.page)![1];

  return (
    <div className={`shell${collapsed ? " min" : ""}${drawer ? " drawer" : ""}`}>
      <Sidebar route={route} go={go} collapsed={collapsed} toggle={toggle} />
      <div className="scrim" onClick={() => setDrawer(false)} aria-hidden="true" />
      <div className="col">
        <header className="top">
          <div className="top-in">
            <button className="btn icon ghost menu-btn" aria-label="Buka menu" onClick={() => setDrawer(true)}><MenuIcon /></button>
            <div className="top-title">{title}</div>
            <span className="sp" />
            <span className={`live-badge${snap?.running ? " on" : ""}`}>{snap?.running ? "● LIVE" : "JEDA"}</span>
            <span className={`conn ${conn}`}><i /><span className="conn-t">{conn === "open" ? "Terhubung" : conn === "connecting" ? "Menghubungkan…" : "Terputus, mencoba lagi…"}</span></span>
          </div>
          <SimBar />
        </header>
        <main>
          {!meta || !snap ? (
            <div className="empty">{conn === "closed" ? "Server belum berjalan. Jalankan start.bat (atau python run.py di folder backend); halaman ini tersambung otomatis." : "Memuat data…"}</div>
          ) : route.page === "overview" ? <Overview go={go} />
            : route.page === "monitor" ? <Monitor assetId={route.asset} go={go} />
            : route.page === "alerts" ? <ActionHub go={go} />
            : route.page === "rca" ? <Rca assetId={route.asset} go={go} />
            : route.page === "models" ? <Models go={go} />
            : <DataPage go={go} />}
        </main>
      </div>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast" onClick={() => { dismiss(t.id); if (t.ev.assetId) go("monitor", t.ev.assetId); }}>
            <i style={{ background: evColor(t.ev.type) }} />
            <div>{t.ev.assetId && <b>{t.ev.assetId} · {STATUS_LABEL[t.ev.type] ?? t.ev.type} </b>}<span style={{ opacity: 0.85 }}>{t.ev.text}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sidebar({ route, go, collapsed, toggle }: { route: { page: Page; asset: string | null }; go: (p: Page, a?: string | null) => void; collapsed: boolean; toggle: () => void }) {
  const { meta, snap } = useLive();
  const openAlerts = snap?.alerts.filter((a) => a.open).length ?? 0;
  const units = useMemo(() => {
    if (!meta) return [];
    return UNIT_ORDER.map((u) => ({ code: u, name: meta.assets.find((a) => a.plantCode === u)?.plant.replace(/\s*\(.*\)/, "") ?? u, assets: meta.assets.filter((a) => a.plantCode === u) }))
      .filter((u) => u.assets.length);
  }, [meta]);
  const byId = new Map(snap?.assets.map((a) => [a.id, a]) ?? []);
  const assetPage = route.page === "rca" ? "rca" : "monitor";

  return (
    <aside className="side" aria-label="Navigasi">
      <div className="side-head">
        <button className="brand" onClick={() => go("overview")} title="Catalytech SIGAP">
          <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14.5" fill="none" stroke="currentColor" strokeWidth="2" /><line x1="1.5" y1="16" x2="30.5" y2="16" stroke="currentColor" strokeWidth="1.4" /><text x="16" y="13" textAnchor="middle" fontSize="9" fontWeight="600" fontFamily="IBM Plex Mono, Consolas, monospace" fill="currentColor">AI</text><text x="16" y="25.5" textAnchor="middle" fontSize="7.5" fontFamily="IBM Plex Mono, Consolas, monospace" fill="currentColor">101</text></svg>
          <span className="brand-t"><span className="brand-name">Catalytech <span>SIGAP</span></span><span className="brand-sub">Intelligent Manufacturing</span></span>
        </button>
        <button className="btn icon ghost collapse-btn" onClick={toggle} aria-label={collapsed ? "Lebarkan sidebar" : "Ciutkan sidebar"} title={collapsed ? "Lebarkan" : "Ciutkan"}><CollapseIcon open={!collapsed} /></button>
      </div>
      <nav className="side-nav">
        {PAGES.map(([k, l]) => {
          const Icon = PageIcon[k];
          return (
            <button key={k} className="nav-i" aria-current={route.page === k ? "page" : undefined} onClick={() => go(k)} title={collapsed ? l : undefined}>
              <Icon /><span className="nav-t">{l}</span>
              {k === "alerts" && openAlerts > 0 && <span className="count">{openAlerts}</span>}
            </button>
          );
        })}
      </nav>
      <div className="side-assets">
        <div className="side-label">Aset dipantau</div>
        {units.map((u) => (
          <div key={u.code} className="unit">
            <div className="unit-h" title={u.name}><span className="mono">{u.code}</span><span className="unit-n">{u.name}</span></div>
            {u.assets.map((a) => {
              const s = byId.get(a.id);
              const active = (route.page === "monitor" || route.page === "rca") && route.asset === a.id;
              return (
                <button key={a.id} className={`asset-i${active ? " on" : ""}`} onClick={() => go(assetPage, a.id)}
                  title={`${a.id} · ${a.short} · ${STATUS_LABEL[s?.status ?? "NODATA"]}`}>
                  <span className={`sdot st-${s?.status ?? "NODATA"}`} />
                  <span className="asset-t"><span className="mono">{a.id}</span><span className="asset-n">{a.short}</span></span>
                  <span className="asset-h num">{s?.health ?? "–"}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="side-foot"><b>5 aset data panitia.</b> Jam di luar jendela data asli diisi data <span className="src dummy">Dummy</span> berlabel.</div>
    </aside>
  );
}

function SimBar() {
  const { meta, snap, control, busy } = useLive();
  const [drag, setDrag] = useState<number | null>(null);
  if (!meta || !snap) return null;
  const now = drag ?? snap.now;
  const commit = (v: number) => { setDrag(null); if (v !== snap.now) control("seek", v); };
  const l = snap.kpis.losses;
  return (
    <div className="simbar">
      <div className="simbar-in">
        <div className="sim-left">
          <button className="btn icon" aria-label="Mundur 1 hari" onClick={() => control("seek", Math.max(0, snap.now - 24))}><BackIcon /></button>
          <button className="btn icon primary" aria-label={snap.running ? "Jeda" : "Putar"} onClick={() => control(snap.running ? "pause" : "play")}>{snap.running ? <PauseIcon /> : <PlayIcon />}</button>
          <button className="btn icon" aria-label="Maju 1 hari" onClick={() => control("step", 24)}><FwdIcon /></button>
          <div className="sim-date">{fD(now)}<small>{fHour(now)}</small></div>
        </div>
        <div className="scrub">
          <input type="range" min={0} max={meta.nHours - 1} step={1} value={now} aria-label="Tanggal simulasi"
            onChange={(e) => setDrag(+e.target.value)} onPointerUp={(e) => commit(+(e.target as HTMLInputElement).value)}
            onKeyUp={(e) => commit(+(e.target as HTMLInputElement).value)} />
          <div className="scoreline">
            {busy ? <span className="busy">{busy}</span> : (
              <>
                <span>kerugian 5 kasus, kenyataan <b>{usd(l.realityEnd)}</b></span>
                {snap.mode !== "reality" && <span>{MODE_LABEL[snap.mode]} <b>{usd(l.scenarioEnd)}</b></span>}
                {snap.mode !== "reality" && <span>terhindar <b style={{ color: "var(--good)" }}>{usd(l.realityEnd - l.scenarioEnd)}</b></span>}
                {snap.mode === "reality" && <span className="muted">pilih SIGAP otomatis / Manual untuk melihat kerugian yang bisa dihindari</span>}
              </>
            )}
          </div>
        </div>
        <div className="sim-right">
          <select className="sel" aria-label="Kecepatan simulasi" value={snap.speed} onChange={(e) => control("speed", +e.target.value)}>
            {meta.speeds.map((s) => <option key={s} value={s}>{s === 1 ? "1 jam" : s < 24 ? `${s} jam` : s === 24 ? "1 hari" : s === 168 ? "1 minggu" : `${s / 24} hari`} / detik</option>)}
          </select>
          <label className="chk"><input type="checkbox" checked={snap.pauseOnAlert} onChange={(e) => control("pauseOnAlert", e.target.checked)} /> Jeda saat alert</label>
          <div className="seg" role="group" aria-label="Skenario">
            {(["reality", "auto", "manual"] as Mode[]).map((m) => (
              <button key={m} aria-pressed={snap.mode === m} onClick={() => control("mode", m)} title={m === "reality" ? "Tidak ada tindakan, sesuai yang terjadi" : m === "auto" ? "Intervensi otomatis sesuai SLA" : "Anda yang memutuskan intervensi"}>{MODE_LABEL[m]}</button>
            ))}
          </div>
          <button className="btn sm ghost" onClick={() => control("reset")} title="Kembali ke 5 Jan 2026, hapus semua tindakan">Ulang</button>
        </div>
      </div>
    </div>
  );
}
