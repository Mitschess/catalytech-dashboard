import { useMemo, useState } from "react";
import { Alert, AlertsResp, CapaRow, days, fD, fDT, nf, send, usd, WorkOrder } from "../api";
import { useLive, useLiveFetch } from "../live";
import type { Page } from "../App";
import { Info, Panel, Prio, StatusChip, Tag, Tile } from "../components/ui";

type Show = "open" | "all";
const WO_STATES: WorkOrder["status"][] = ["Open", "Dikerjakan", "Selesai"];

function loadName(): string {
  try { return localStorage.getItem("sigap.name") || "Engineer"; } catch { return "Engineer"; }
}
function saveName(v: string) {
  try { localStorage.setItem("sigap.name", v); } catch { /* storage unavailable: keep in memory only */ }
}

export default function ActionHub({ go }: { go: (p: Page, a?: string | null) => void }) {
  const { snap, assetMeta, notify, control } = useLive();
  const { data, err, reload } = useLiveFetch<AlertsResp>("/api/alerts", 1500);
  const capa = useLiveFetch<{ now: number; capa: CapaRow[] }>("/api/capa", 4000);
  const [show, setShow] = useState<Show>("open");
  const [name, setName] = useState(loadName);
  const [busy, setBusy] = useState<string | null>(null);
  const now = snap!.now;
  const k = snap!.kpis;

  const alerts = useMemo(() => (data?.alerts ?? [])
    .filter((a) => show === "all" || a.open)
    .sort((x, y) => Number(y.open) - Number(x.open) || y.level - x.level || Number(y.overdue) - Number(x.overdue) || x.raisedH - y.raisedH),
  [data, show]);
  const wos = data?.workorders ?? [];
  const activeWo = (data?.workorders ?? []).filter((w) => w.status !== "Selesai").length;

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); notify(ok); await reload(); } catch (e) { notify((e as Error).message); } finally { setBusy(null); }
  };
  const ack = (a: Alert) => act(`ack-${a.id}`, () => send(`/api/alerts/${encodeURIComponent(a.id)}/ack`, "POST", { by: name.trim() || "Engineer" }), `Alert ${a.assetId} di-acknowledge oleh ${name.trim() || "Engineer"}.`);
  const mkWo = (a: Alert) => act(`wo-${a.id}`, () => send(`/api/alerts/${encodeURIComponent(a.id)}/workorder`), `Work order dibuat untuk ${a.assetId}.`);
  const intervene = (a: Alert) => act(`iv-${a.id}`, () => send(`/api/assets/${encodeURIComponent(a.assetId)}/intervene`), `Intervensi ${a.assetId} dijadwalkan.`);
  const setWo = (w: WorkOrder, status: string) => act(`w-${w.id}`, () => send(`/api/workorders/${w.id}`, "PATCH", { status }), `WO #${w.id} → ${status}.`);

  const capaRows = capa.data?.capa ?? [];
  const capaLate = capaRows.filter((c) => c.state === "Terlambat").length;

  return (
    <>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Tampilkan alert">
          <button aria-pressed={show === "open"} onClick={() => setShow("open")}>Terbuka</button>
          <button aria-pressed={show === "all"} onClick={() => setShow("all")}>Semua</button>
        </div>
        <label className="chk">Nama
          <input className="txt" value={name} onChange={(e) => { setName(e.target.value); saveName(e.target.value); }} maxLength={40} style={{ width: 130 }} />
        </label>
        <span className="sp" />
        {snap!.mode !== "manual" && <button className="btn sm" onClick={() => control("mode", "manual")} title="Di mode Manual Anda yang memutuskan kapan intervensi">Mode Manual untuk intervensi</button>}
      </div>

      <div className="tiles">
        <Tile label="P1 terbuka" value={k.alerts.P1} ctx="SLA 24 jam" tone={k.alerts.P1 ? "warn" : undefined} />
        <Tile label="P2 terbuka" value={k.alerts.P2} ctx="SLA 7 hari" />
        <Tile label="P3 terbuka" value={k.alerts.P3} ctx="SLA 7 hari" />
        <Tile label="Nilai risiko" value={usd(k.varUsd)} ctx="P(gagal) × kerugian trip" />
        <Tile label="SLA terlewat" value={k.overdue} ctx="tanpa ack / WO / intervensi" tone={k.overdue ? "warn" : undefined} />
        <Tile label="Work order aktif" value={activeWo} ctx={`${(data?.workorders ?? []).length} dibuat`} />
      </div>

      <Panel title={<>Antrian alert <Info text="Diurutkan menurut prioritas. Risiko = P(gagal) × kerugian jika trip; P(gagal): P1 90%, P2 60% bila prediksi trip ≤ 45 hari (selain itu 40%), P3 15%. 'Skor lama' = skor matriks risiko lama di Incident Database." /></>}
        sub={`${alerts.length} alert`}>
        {err && <div className="empty">Gagal memuat alert: {err}</div>}
        {!data && !err ? <div className="empty">Memuat…</div> : alerts.length === 0 ? (
          <div className="empty">{show === "open" ? "Tidak ada alert terbuka pada waktu simulasi ini." : "Belum ada alert."}</div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr>
                <th>Prio</th><th>Aset</th><th className="wrap">Alasan</th><th>Dibuka</th><th>Prediksi trip</th><th className="r">Risiko</th><th>Tenggat SLA</th><th>Tindak lanjut</th><th>Aksi</th>
              </tr></thead>
              <tbody>
                {alerts.map((a) => {
                  const m = assetMeta(a.assetId);
                  const pd = a.predH != null ? days(now, a.predH) : null;
                  return (
                    <tr key={a.id} className={a.open && a.level === 3 ? "hl" : undefined}>
                      <td><div className="row" style={{ gap: 4, flexWrap: "nowrap" }}><Prio p={a.prio} />{a.open ? <StatusChip status={a.status} /> : <StatusChip status={a.outcome === "trip" ? "TRIP" : "MAINT"} />}</div></td>
                      <td title={`${m?.short} · ${m?.plantCode} · ${a.disc} / ${a.owner}`}>
                        <button className="btn sm ghost" style={{ padding: 0 }} onClick={() => go("monitor", a.assetId)}><Tag id={a.assetId} /></button>
                        <div className="xs muted" style={{ marginTop: 2, whiteSpace: "nowrap" }}>{m?.plantCode} · {a.owner}</div>
                      </td>
                      <td className="wrap" title={`Lapis: ${a.layer}`}>{a.reason}{!a.open && a.closedH != null && <div className="xs muted">ditutup {fD(a.closedH)} ({a.outcome === "trip" ? "trip" : "intervensi"})</div>}</td>
                      <td className="num">{fD(a.raisedH)}<div className="xs muted">{days(a.raisedH, now)} hari lalu</div></td>
                      <td className="num">{a.predH != null ? <>{fD(a.predH)}<div className="xs muted">{pd} hari lagi</div></> : <span className="muted">–</span>}</td>
                      <td className="r">
                        {a.open ? <><b>{usd(a.varUsd)}</b><div className="xs muted">{nf(a.p * 100)}% × {usd(a.tripLoss)}</div></> : <span className="muted">–</span>}
                        {a.oldPreRisk && <div className="xs muted" title="Skor dari matriks risiko lama di Incident Database">skor lama {a.oldPreRisk} / {a.oldScore}</div>}
                      </td>
                      <td className="num">{a.open ? <>{fD(a.dueH)}{a.overdue ? <div className="xs" style={{ color: "var(--crit)", fontWeight: 600 }}>Terlambat {Math.max(1, days(a.dueH, now))} hari</div>
                        : <div className="xs muted">{a.dueH >= now ? `sisa ${Math.max(0, Math.round((a.dueH - now) / 24 * 10) / 10)} hari` : "sudah ditindak"}</div>}</> : <span className="muted">–</span>}</td>
                      <td className="xs">
                        {a.ack && <div>Ack: {a.ack.by}, {fDT(a.ack.h)}</div>}
                        {a.woId != null && <div>WO #{a.woId} · {a.woStatus}</div>}
                        {a.scheduledH != null && <div style={{ color: "var(--good)" }}>Intervensi {fDT(a.scheduledH)}</div>}
                        {!a.ack && a.woId == null && a.scheduledH == null && <span className="muted">belum ada</span>}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                          {a.open && !a.ack && <button className="btn sm" disabled={busy === `ack-${a.id}`} onClick={() => ack(a)}>Ack</button>}
                          {a.open && a.woId == null && <button className="btn sm" disabled={busy === `wo-${a.id}`} onClick={() => mkWo(a)}>Buat WO</button>}
                          {a.open && snap!.mode === "manual" && a.scheduledH == null && <button className="btn sm primary" disabled={busy === `iv-${a.id}`} onClick={() => intervene(a)}>Intervensi</button>}
                          <button className="btn sm ghost" onClick={() => go("rca", a.assetId)}>RCA</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="gap" />
      <Panel title={<>Work order <Info text="Tersimpan di database lokal (SQLite). Di pabrik diteruskan ke CMMS (SAP PM / Maximo)." /></>}>
        {wos.length === 0 ? <div className="empty">Belum ada work order. Buat dari tombol "Buat WO" pada alert.</div> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>#</th><th>Aset</th><th className="wrap">Judul</th><th>Prio</th><th>Owner</th><th>Dibuat</th><th>Tenggat</th><th>Status</th></tr></thead>
              <tbody>
                {wos.map((w) => (
                  <tr key={w.id}>
                    <td className="mono">{w.id}</td>
                    <td><Tag id={w.assetId} /></td>
                    <td className="wrap">{w.title}</td>
                    <td><Prio p={w.prio} /></td>
                    <td>{w.owner}</td>
                    <td className="num">{fDT(w.createdH)}</td>
                    <td className="num">{fDT(w.dueH)}{w.status !== "Selesai" && w.dueH != null && now > w.dueH && <div className="xs" style={{ color: "var(--crit)" }}>lewat tenggat</div>}</td>
                    <td>
                      <select className="sel" aria-label={`Status WO ${w.id}`} value={w.status} disabled={busy === `w-${w.id}`} onChange={(e) => setWo(w, e.target.value)}>
                        {WO_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="gap" />
      <Panel title={<>Pelacakan CAPA <Info text="Tindakan dari laporan RCA yang sudah terbit (data panitia). Status kini dihitung terhadap tanggal simulasi." /></>}
        sub={capaRows.length ? `${capaRows.length} tindakan · ${capaLate} terlambat` : undefined}>
        {capaRows.length === 0 ? (
          <div className="empty">Belum ada laporan RCA yang terbit pada {fD(now)}.</div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Aset</th><th>AR</th><th>Akar</th><th className="wrap">Tindakan</th><th>Jenis</th><th>PIC</th><th>Tenggat</th><th>Status laporan</th><th>Status kini</th></tr></thead>
              <tbody>
                {capaRows.map((c, i) => (
                  <tr key={`${c.ar}-${i}`}>
                    <td><Tag id={c.assetId} /></td>
                    <td className="mono xs">{c.ar}</td>
                    <td className="mono">{c.rc}</td>
                    <td className="wrap">{c.action}</td>
                    <td>{c.kind}</td>
                    <td>{c.pic}</td>
                    <td className="num">{fD(c.dueH)}</td>
                    <td>{c.status}</td>
                    <td>
                      <span className={`okng ${c.state === "Terlambat" ? "NG" : c.state === "Closed" ? "OK" : "G"}`}>{c.state}</span>
                      {c.state === "Terlambat" && <div className="xs muted">{c.days} hari</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
