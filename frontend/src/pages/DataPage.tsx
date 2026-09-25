import { useMemo } from "react";
import { fD, nf, UNIT_ORDER, usd } from "../api";
import { useLive } from "../live";
import type { Page } from "../App";
import { Info, Panel, Tag, Tile } from "../components/ui";
import { Kpi } from "../components/icons";
import { Coverage } from "../components/Coverage";

const ARCH: [string, string, string][] = [
  ["Sumber data proses", "Simulated historian: replay data PI panitia + isian dummy berlabel", "Konektor PI Web API / OPC UA, baca satu arah (read-only) tiap 1 menit"],
  ["Condition monitoring", "Condition History dari file Equipment Performance", "Ekspor rutin dari sistem CM (vibrasi, analisis oli) atau input tablet teknisi"],
  ["Analitik & AI", "FastAPI + numpy: aturan, tren, MSPC per aset", "Sama; dijalankan sebagai service terjadwal di server internal"],
  ["Penyimpanan", "SQLite (ack, work order, intervensi)", "PostgreSQL + TimescaleDB untuk time-series dan audit trail"],
  ["Live feed", "WebSocket langsung dari FastAPI", "WebSocket + Redis pub/sub untuk banyak pengguna"],
  ["Work order", "Tabel work order lokal", "Integrasi SAP PM / Maximo (buat notifikasi & WO otomatis)"],
  ["Notifikasi", "Toast di dashboard", "Microsoft Teams / email untuk P1, ringkasan harian untuk P2/P3"],
  ["Akses & keamanan", "Tanpa login (demo lokal)", "SSO perusahaan, peran (operator, engineer, manajer), zona IT/OT sesuai IEC 62443"],
];

const API: [string, string, string][] = [
  ["GET", "/api/meta", "Daftar aset, sinyal, batas, SLA, ringkasan Incident Database"],
  ["GET", "/api/state", "Snapshot live: status aset, alert, kejadian, KPI"],
  ["WS", "/ws", "Aliran live; kirim {type:\"subscribe\", assetId} untuk sampel per jam satu aset"],
  ["GET", "/api/assets/{id}/history?hours=168", "Riwayat sinyal, skor AI, condition monitoring, prediksi"],
  ["GET", "/api/alerts", "Semua alert + work order + KPI"],
  ["POST", "/api/alerts/{id}/ack", "Acknowledge alert {by}"],
  ["POST", "/api/alerts/{id}/workorder", "Buat work order dari alert"],
  ["PATCH", "/api/workorders/{id}", "Ubah status WO {status: Open | Dikerjakan | Selesai}"],
  ["POST", "/api/assets/{id}/intervene", "Jadwalkan intervensi terencana (mode Manual)"],
  ["GET", "/api/rca/{id}", "Verifikasi parameter, hipotesis, insiden serupa, draf laporan"],
  ["POST", "/api/rca/{id}/ask", "Analisis Claude (Server-Sent Events)"],
  ["GET", "/api/models", "Status model AI per aset"],
  ["POST", "/api/models/{id}/retrain", "Latih ulang model dari data normal terbaru {hours}"],
  ["GET", "/api/capa", "Tindakan CAPA dari laporan RCA yang sudah terbit"],
  ["POST", "/api/sim/control", "Kendali simulasi {action: play | pause | step | seek | speed | mode | reset}"],
];

export default function DataPage({ go }: { go: (p: Page, a?: string | null) => void }) {
  const { meta, snap } = useLive();
  const inc = meta!.incidents;
  const assets = useMemo(() => [...meta!.assets].sort((a, b) => UNIT_ORDER.indexOf(a.plantCode) - UNIT_ORDER.indexOf(b.plantCode)), [meta]);
  const realHours = assets.reduce((t, a) => t + (a.hourlyWindow ? a.hourlyWindow[1] - a.hourlyWindow[0] + 1 : 0), 0);
  const share = realHours / (assets.length * meta!.nHours);

  return (
    <>
      <div className="tiles t4">
        <Tile icon={<Kpi.asset />} label="Aset data panitia" value={assets.length} ctx="5 kasus RCA" />
        <Tile icon={<Kpi.chart />} label="Data per jam asli" value={`${nf(share * 100)}%`} ctx={`${nf(realHours)} jam; sisanya dummy`} />
        <Tile icon={<Kpi.list />} label="Insiden di database" value={nf(inc.n)} ctx={`${usd(inc.totalLoss)} kerugian`} />
        <Tile icon={<Kpi.clock />} teal label="Rentang simulasi" value={`${fD(0).replace(/ \d{4}$/, "")} – ${fD(meta!.nHours - 1)}`} ctx={`${nf(meta!.nHours)} jam`} />
      </div>

      <Panel title={<>Cakupan data per aset <Info text="Semua aset, kejadian dan kerugian dari file panitia. Data PI per jam asli hanya 30 hari per aset, di bulan berbeda; jam lain diisi dummy berlabel (pola normal dari hari normal aset itu sendiri). Isian tidak pernah menjadi bukti kerusakan dan tidak mengubah kerugian." /></>}>
        <Coverage assets={assets} nHours={meta!.nHours} now={snap!.now} simStart={meta!.simStart} onOpen={(id) => go("monitor", id)} />
      </Panel>

      <div className="gap" />
      <Panel title={<>Sumber data per aset <Info text="Isian dummy per jam: hari utuh diambil acak dari hari normal asli aset itu (minimal 3 hari sebelum trip) + noise kecil. Mingguan: di sekitar baseline sehat. Tes otomatis memastikan isian tidak pernah memicu alert." /></>}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Aset</th><th>Unit</th><th>Jenis</th><th>Class</th><th>PI per jam asli</th><th>Condition monitoring asli</th><th>Trip nyata</th><th className="r">Sinyal</th><th>Laporan RCA</th></tr></thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id}>
                  <td><button className="btn sm ghost" style={{ padding: 0 }} onClick={() => go("monitor", a.id)}><Tag id={a.id} /></button><div className="xs muted" style={{ marginTop: 3 }}>{a.short}</div></td>
                  <td className="small">{a.plant}</td>
                  <td className="small">{a.eqType}</td>
                  <td>{a.cls}</td>
                  <td className="num small">{a.hourlyWindow ? `${fD(a.hourlyWindow[0])} – ${fD(a.hourlyWindow[1])}` : "–"}</td>
                  <td className="num small">{a.weeklyWindow ? `${fD(a.weeklyWindow[0])} – ${fD(a.weeklyWindow[1])}` : "–"}</td>
                  <td className="num small">{fD(a.tripStart)}</td>
                  <td className="r">{a.hourly.length + a.weekly.length}</td>
                  <td className="mono xs">{a.ar ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="gap" />
      <div className="grid g2">
        <Panel title="Status insiden" sub="Jan 2024 – Jul 2026">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Status</th><th className="r">Insiden</th><th className="r">Kerugian</th><th style={{ width: "35%" }} /></tr></thead>
              <tbody>
                {inc.byStatus.map((s) => {
                  const max = Math.max(...inc.byStatus.map((x) => x.loss));
                  return (
                    <tr key={s.k}>
                      <td className="small">{s.k}</td><td className="r">{nf(s.n)}</td><td className="r">{usd(s.loss)}</td>
                      <td><div className="bar-inline"><span style={{ width: `${(s.loss / max) * 100}%` }} /></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="note">RCA lewat tenggat: {inc.rcaOverdue}/{inc.rcaStage} · skor lama vs kerugian ρ = {nf(inc.spearman, 2)}</div>
        </Panel>
        <Panel title="Backlog RCA terbesar" sub="menurut kerugian">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Judul</th><th>Skor lama</th><th className="r">Kerugian</th><th className="r">Terlambat</th></tr></thead>
              <tbody>
                {inc.backlog.slice(0, 10).map((b) => (
                  <tr key={b.id}>
                    <td className="small" title={b.plant}>{b.title}<div className="xs muted">{b.status}</div></td>
                    <td className="small">{b.prerisk} / {b.score}</td><td className="r">{usd(b.loss)}</td>
                    <td className="r">{b.overdueDays != null ? `${nf(b.overdueDays)} hari` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="gap" />
      <Panel title="Arsitektur & integrasi">
        <details className="more" style={{ marginTop: 0 }}>
          <summary>Demo ini vs penerapan di pabrik</summary>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Komponen</th><th className="wrap">Demo (laptop)</th><th className="wrap">Produksi (server pabrik)</th></tr></thead>
              <tbody>{ARCH.map(([c, d, p]) => <tr key={c}><td><b>{c}</b></td><td className="wrap small">{d}</td><td className="wrap small">{p}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
        <details className="more">
          <summary>API untuk integrasi (dokumentasi lengkap di /docs)</summary>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Metode</th><th>Endpoint</th><th className="wrap">Fungsi</th></tr></thead>
              <tbody>{API.map(([m, p, d]) => <tr key={p + m}><td className="mono xs">{m}</td><td className="mono xs">{p}</td><td className="wrap small">{d}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      </Panel>
    </>
  );
}
