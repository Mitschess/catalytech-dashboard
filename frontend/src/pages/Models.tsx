import { useMemo, useState } from "react";
import { AlertsResp, fD, fDT, ModelRow, nf, send, usd } from "../api";
import { useLive, useLiveFetch } from "../live";
import type { Page } from "../App";
import { Meter, Panel, Tag, Tile } from "../components/ui";

const LAYERS: [string, string, string, string][] = [
  ["1. Kualitas data", "Sensor yang tidak berubah 6 jam (flatline) memicu alert DATA. Model AI berhenti menilai aset itu supaya sensor rusak tidak dikira kerusakan mesin.", "Tidak", "Aturan"],
  ["2. Batas & tren per jam", "Batas alarm/trip pada rata-rata 6 jam, drift > 10% dari baseline selama 24 jam, dan tren harian kuadratik yang memproyeksikan tanggal melewati batas trip.", "Tidak", "Baseline otomatis dari 7 hari operasi pertama"],
  ["3. Condition monitoring mingguan", "Pembacaan rute (vibrasi, oli, suhu bearing). Tren kuadratik 8 pembacaan terakhir memberi prediksi tanggal trip dan alert P2 (≤ 45 hari) atau P1 (≤ 14 hari).", "Tidak", "Baseline dari 4 pembacaan awal"],
  ["4. AI anomali (MSPC)", "PCA + Hotelling T² + SPE. Belajar pola operasi normal lalu menandai data yang jauh dari pola itu (T²) atau yang merusak hubungan antar-tag (SPE).", "Ya, data normal saja", "336 jam operasi normal, tanpa contoh kegagalan"],
  ["5. Asisten RCA (Claude)", "Membaca kondisi, skor AI, pustaka mode kegagalan, insiden serupa dan laporan RCA terbit, lalu menulis analisis probable root cause.", "Tidak (tanpa fine-tuning)", "Konteks dari dashboard pada saat ditanya"],
];

export default function Models({ go }: { go: (p: Page, a?: string | null) => void }) {
  const { snap, assetMeta, notify } = useLive();
  const { data, err, reload } = useLiveFetch<{ now: number; models: ModelRow[] }>("/api/models", 2500);
  const alerts = useLiveFetch<AlertsResp>("/api/alerts", 3000);
  const [busy, setBusy] = useState<string | null>(null);
  const models = data?.models ?? [];
  const ready = models.filter((x) => x.ready).length;

  const retrain = async (aid: string) => {
    setBusy(aid);
    try {
      const r = await send<{ info: { n: number; k: number } }>(`/api/models/${encodeURIComponent(aid)}/retrain`, "POST", { hours: 336 });
      notify(`Model ${aid} dilatih ulang dari ${r.info.n} jam data normal (${r.info.k} komponen).`);
      await reload();
    } catch (e) { notify((e as Error).message); } finally { setBusy(null); }
  };

  // Lead time: how long before each unplanned trip the first warning was raised, measured on this replay.
  const lead = useMemo(() => (alerts.data?.alerts ?? []).filter((a) => a.outcome === "trip" && a.closedH != null)
    .map((a) => ({ a, days: (a.closedH! - a.raisedH) / 24, p2: a.first["2"] ?? a.first["3"], p1: a.first["3"] }))
    .sort((x, y) => (x.a.source === y.a.source ? x.a.closedH! - y.a.closedH! : x.a.source === "real" ? -1 : 1)), [alerts.data]);
  const realLead = lead.filter((x) => x.a.source === "real");
  const medianLead = realLead.length ? [...realLead].sort((x, y) => x.days - y.days)[Math.floor(realLead.length / 2)].days : null;

  return (
    <>
      <div className="page-head">
        <div><div className="eyebrow">Transparansi model</div><h1>Model AI</h1>
          <p>Model anomali dilatih otomatis dari data operasi normal setiap aset saat simulasi berjalan, tanpa contoh kegagalan.
            Halaman ini menunjukkan apa yang dipelajari tiap model, seberapa sering ia menandai anomali, dan seberapa awal peringatan muncul sebelum trip.</p></div>
      </div>

      <div className="tiles t4">
        <Tile label="Model aktif" value={`${ready}/${models.length || snap!.kpis.models.total}`} ctx="model MSPC per aset" />
        <Tile label="Trip pada replay ini" value={lead.length} ctx={snap!.mode === "reality" ? "mode Kenyataan: tanpa tindakan" : "sebagian dicegah oleh intervensi"} />
        <Tile label="Median peringatan dini (5 kasus nyata)" value={medianLead != null ? `${nf(medianLead)} hari` : "–"} ctx="dari alert pertama sampai trip" tone={medianLead != null ? "good" : undefined} />
        <Tile label="Kerugian terhindar (proyeksi)" value={usd(snap!.kpis.losses.realityEnd - snap!.kpis.losses.scenarioEnd)} ctx="5 kasus nyata, mode aktif vs kenyataan" />
      </div>

      <Panel title="Status model per aset" sub="PCA dengan batas 99,9 persentil dari data latih">
        {err && <div className="empty">Gagal memuat model: {err}</div>}
        {!data && !err ? <div className="empty">Memuat…</div> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>
                <th>Aset</th><th>Status</th><th>Data latih</th><th className="r">Komponen</th><th className="r">Variansi</th><th className="r">Jam dinilai</th>
                <th className="r">Jam anomali</th><th className="r">Skor terakhir</th><th>Input model</th><th>Aksi</th>
              </tr></thead>
              <tbody>
                {models.map((x) => {
                  const m = assetMeta(x.assetId);
                  const names = x.keys.map((k) => m?.hourly.find((s) => s.key === k)?.name ?? k);
                  return (
                    <tr key={x.assetId}>
                      <td><Tag id={x.assetId} /><div className="xs muted" style={{ marginTop: 3 }}>{m?.short} · {m?.plantCode}</div></td>
                      <td style={{ minWidth: 130 }}>
                        {x.ready ? <span className="chip st-MAINT">Aktif</span>
                          : x.progress > 0 ? <><span className="small">Belajar {nf(x.progress * 100)}%</span><div style={{ marginTop: 4 }}><Meter value={x.progress * 100} status="PULIH" /></div></>
                            : <span className="chip st-NODATA">Menunggu data</span>}
                      </td>
                      <td className="num small">{x.trainedRange ? <>{x.info.n} jam {x.realShare === 0 ? <span className="src dummy">isian</span> : <span className="src real">{nf((x.realShare ?? 0) * 100)}% asli</span>}
                        <div className="xs muted">{fD(x.trainedRange[0])}–{fD(x.trainedRange[1])}</div></> : `${x.nTrain} jam dibutuhkan`}</td>
                      <td className="r">{x.info.k != null ? `${x.info.k}/${x.info.p}` : "–"}</td>
                      <td className="r">{x.info.explained != null ? `${nf(x.info.explained * 100)}%` : "–"}</td>
                      <td className="r">{nf(x.scored)}</td>
                      <td className="r">{x.ready ? <>{nf(x.anomalyHours)}<div className="xs muted">{x.scored ? `${nf((x.anomalyHours / x.scored) * 100, 1)}%` : ""}</div></> : "–"}</td>
                      <td className="r">{x.lastRatio != null ? <b style={{ color: x.lastRatio > 1 ? "var(--crit)" : undefined }}>{nf(x.lastRatio, 2)}×</b> : "–"}</td>
                      <td className="xs" style={{ minWidth: 150 }}>{names.join(", ")}</td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          <button className="btn sm" disabled={busy === x.assetId || !x.scored} onClick={() => retrain(x.assetId)}
                            title="Latih ulang dari data normal 14 hari terakhir, mis. setelah overhaul atau perubahan titik operasi">Latih ulang</button>
                          <button className="btn sm ghost" onClick={() => go("monitor", x.assetId)}>Grafik</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="note">Jam anomali = jam dengan skor di atas batas (1×). Satu jam di atas batas belum menjadi alert; alert P2 butuh 3 jam berturut-turut.
          Latih ulang hanya memakai jam berstatus normal dalam 14 hari terakhir (minimal 48 jam).</div>
      </Panel>

      <div style={{ height: 14 }} />
      <Panel title="Validasi: seberapa awal SIGAP memberi peringatan sebelum trip" sub="dihitung dari replay yang sedang berjalan, hanya data sampai waktu simulasi">
        {lead.length === 0 ? (
          <div className="empty">Belum ada trip hingga {fD(snap!.now)}{snap!.mode !== "reality" ? " (atau semua trip dicegah oleh intervensi)" : ""}.
            Putar simulasi di mode Kenyataan melewati Maret–Juli 2026 untuk melihat lead time kelima kasus nyata.</div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Aset</th><th>Peringatan pertama</th><th>Alert P2</th><th>Alert P1</th><th>Trip</th><th className="r">Lebih awal</th><th>Lapis terakhir</th><th className="r">Kerugian trip</th></tr></thead>
              <tbody>
                {lead.map(({ a, days, p2, p1 }) => (
                  <tr key={a.id}>
                    <td><Tag id={a.assetId} /></td>
                    <td className="num">{fDT(a.raisedH)}</td>
                    <td className="num">{p2 != null ? fDT(p2) : "–"}</td>
                    <td className="num">{p1 != null ? fDT(p1) : "–"}</td>
                    <td className="num">{fDT(a.closedH)}</td>
                    <td className="r"><b>{nf(days)} hari</b></td>
                    <td className="xs">{a.layer}</td>
                    <td className="r">{usd(a.tripLoss)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="callout" style={{ marginTop: 10 }}>
          <b>Catatan kejujuran data.</b> Model dilatih dari 2 minggu pertama timeline, yang berupa isian dummy yang disusun dari hari-hari normal asli aset itu
          (tanpa 3 hari menjelang trip). Pada 30 hari data PI asli, model menandai anomali 1–2 hari sebelum trip (lihat grafik Skor AI di Monitor aset), sedangkan
          peringatan paling awal (84–105 hari) datang dari tren condition monitoring mingguan. Data PI panitia bersifat sintetis dan antar-tag hampir tidak berkorelasi,
          sehingga di sini MSPC mirip aturan 3σ per tag; di pabrik nyata kekuatannya ada pada hubungan antar-tag (mis. ampere naik tanpa kenaikan flow).
        </div>
      </Panel>

      <div style={{ height: 14 }} />
      <div className="grid">
        <Panel title="Lima lapis analitik" sub="apa yang perlu dilatih dan apa yang tidak">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Lapis</th><th className="wrap">Fungsi</th><th>Perlu training?</th><th>Data yang dibutuhkan</th></tr></thead>
              <tbody>{LAYERS.map(([l, f, t, d]) => <tr key={l}><td><b>{l}</b></td><td className="wrap small">{f}</td><td className="small">{t}</td><td className="small">{d}</td></tr>)}</tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Menerapkan model di pabrik" sub="dari demo ke operasi">
          <ol className="small" style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
            <li><b>Pilih aset & tag.</b> Mulai dari aset Class A dengan riwayat kerugian terbesar; pastikan tag wajib per jenis aset tersedia di historian.</li>
            <li><b>Tarik 3–6 bulan data.</b> Tandai periode operasi normal (tanpa trip, start-up, atau perbaikan) sebagai data latih.</li>
            <li><b>Latih MSPC per aset.</b> Batas 99,9 persentil, cek jumlah komponen dan variansi yang dijelaskan seperti tabel di atas.</li>
            <li><b>Shadow mode 3 bulan.</b> Model berjalan tanpa memicu tindakan; engineer menilai setiap alert benar atau salah. Target presisi ≥ 70%.</li>
            <li><b>Go-live dengan SLA.</b> Alert masuk Action Hub dan work order (SAP PM / Maximo), notifikasi Teams/email untuk P1.</li>
            <li><b>Rawat model.</b> Latih ulang setelah overhaul atau perubahan titik operasi; kumpulkan label kegagalan untuk model klasifikasi mode kegagalan di tahun ke-2.</li>
          </ol>
        </Panel>
      </div>
    </>
  );
}
