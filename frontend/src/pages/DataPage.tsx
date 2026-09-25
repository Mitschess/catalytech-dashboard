import { useMemo } from "react";
import { fD, nf, UNIT_ORDER, usd } from "../api";
import { useLive } from "../live";
import type { Page } from "../App";
import { Panel, SourceBadge, Tag, Tile } from "../components/ui";
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
      <div className="page-head">
        <div><div className="eyebrow">Asal-usul data</div><h1>Data & sumber</h1>
          <p>Semua aset, kejadian, dan angka kerugian berasal dari file panitia <SourceBadge source="real" /> (Incident Database, Equipment Performance,
            Production Data, laporan RCA). Data PI per jam panitia hanya 30 hari per aset dan bulannya berbeda-beda, jadi jam di luar periode itu diisi{" "}
            <SourceBadge source="dummy" /> berlabel: pola operasi normal yang disusun dari hari-hari normal aset itu sendiri. Isian ini tidak pernah
            menjadi bukti kerusakan dan tidak mengubah angka kerugian.</p></div>
      </div>

      <div className="tiles t4">
        <Tile label="Aset data panitia" value={assets.length} ctx="5 kasus RCA dengan data sensor" />
        <Tile label="Data per jam asli" value={`${nf(share * 100)}%`} ctx={`${nf(realHours)} jam PI asli; sisanya isian dummy`} />
        <Tile label="Insiden di database" value={nf(inc.n)} ctx={`${usd(inc.totalLoss)} total kerugian`} />
        <Tile label="Rentang simulasi" value={`${fD(0).replace(/ \d{4}$/, "")} – ${fD(meta!.nHours - 1)}`} ctx={`${nf(meta!.nHours)} jam, diputar ulang seolah live`} />
      </div>

      <Panel title="Cakupan data per aset" sub="data per jam asli tiap aset ada di bulan yang berbeda; isian dummy menyambungkannya menjadi satu timeline">
        <Coverage assets={assets} nHours={meta!.nHours} now={snap!.now} simStart={meta!.simStart} onOpen={(id) => go("monitor", id)} />
      </Panel>

      <div style={{ height: 14 }} />
      <Panel title="Sumber data per aset">
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
        <div className="note">Isian dummy per jam: hari-hari utuh diambil acak dari hari normal aset itu di data PI asli (berjalan, dan minimal 3 hari sebelum trip), ditambah noise kecil.
          Isian mingguan: di sekitar baseline sehat (rata-rata 4 pembacaan asli pertama). Tes otomatis memastikan isian tidak pernah memicu alert.</div>
      </Panel>

      <div style={{ height: 14 }} />
      <div className="grid g2">
        <Panel title="Status insiden di database" sub="Jan 2024 – Jul 2026" right={<SourceBadge source="real" />}>
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
          <div className="note">{inc.rcaOverdue} dari {inc.rcaStage} insiden di tahap RCA sudah lewat tenggat (median {nf(inc.overdueMedianDays)} hari).
            Korelasi skor risiko lama terhadap kerugian nyata: ρ = {nf(inc.spearman, 2)}.</div>
        </Panel>
        <Panel title="Backlog RCA terbesar" sub="diurutkan menurut kerugian" right={<SourceBadge source="real" />}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Tag</th><th className="wrap">Judul</th><th>Plant</th><th>Skor lama</th><th className="r">Kerugian</th><th className="r">Terlambat</th></tr></thead>
              <tbody>
                {inc.backlog.map((b) => (
                  <tr key={b.id}>
                    <td><Tag id={b.tag} /></td><td className="small">{b.title}<div className="xs muted">{b.status}</div></td><td className="small">{b.plant}</td>
                    <td className="small">{b.prerisk} / {b.score}</td><td className="r">{usd(b.loss)}</td>
                    <td className="r">{b.overdueDays != null ? `${nf(b.overdueDays)} hari` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div style={{ height: 14 }} />
      <Panel title="Arsitektur: demo ini vs penerapan di pabrik" sub="struktur kode sama; hanya komponen di kolom kanan yang diganti">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Komponen</th><th className="wrap">Demo (laptop)</th><th className="wrap">Produksi (server internal pabrik)</th></tr></thead>
            <tbody>{ARCH.map(([c, d, p]) => <tr key={c}><td><b>{c}</b></td><td className="wrap small">{d}</td><td className="wrap small">{p}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="note">Konektor historian cukup mengganti kelas <span className="mono">SimulatedHistorian</span> di <span className="mono">backend/app/sources/historian.py</span>; analitik, alert, dan dashboard tidak berubah.</div>
      </Panel>

      <div style={{ height: 14 }} />
      <Panel title="API untuk integrasi" sub="dokumentasi interaktif lengkap di /docs (Swagger)">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Metode</th><th>Endpoint</th><th className="wrap">Fungsi</th></tr></thead>
            <tbody>{API.map(([m, p, d]) => <tr key={p + m}><td className="mono xs">{m}</td><td className="mono xs">{p}</td><td className="wrap small">{d}</td></tr>)}</tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
