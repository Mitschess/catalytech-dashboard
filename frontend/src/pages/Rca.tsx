import { useEffect, useMemo, useRef, useState } from "react";
import { fD, fDT, fv, nf, RcaView, STATUS_RANK, UNIT_ORDER, usd } from "../api";
import { useLive, useLiveFetch } from "../live";
import type { Page } from "../App";
import { Markdown, Panel, Prio, SourceBadge, StatusChip, Tag } from "../components/ui";

interface Turn { role: "user" | "assistant"; content: string }

/** POST to the SSE endpoint and hand each text chunk to onText. Throws on HTTP or stream errors. */
async function streamAsk(aid: string, body: { question: string | null; history: Turn[] }, onText: (t: string) => void, signal: AbortSignal) {
  const r = await fetch(`/api/rca/${encodeURIComponent(aid)}/ask`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
      buf = buf.slice(i + 2);
      if (!line) continue;
      const msg = JSON.parse(line.slice(6));
      if (msg.error) throw new Error(msg.error);
      if (msg.text) onText(msg.text);
    }
  }
}

export default function Rca({ assetId, go }: { assetId: string | null; go: (p: Page, a?: string | null) => void }) {
  const { meta, snap, assetMeta, notify } = useLive();
  // Without an asset in the URL, open the asset in the worst state.
  const fallback = useMemo(() => [...snap!.assets].sort((x, y) => STATUS_RANK[y.status] - STATUS_RANK[x.status])[0].id, [snap]);
  const id = assetId && assetMeta(assetId) ? assetId : fallback;
  // Pin that choice in the URL so the page does not jump to another asset while the simulation runs.
  useEffect(() => { if (!assetId || !assetMeta(assetId)) location.replace(`#rca/${encodeURIComponent(id)}`); }, [assetId, id, assetMeta]);
  const m = assetMeta(id)!;
  const st = snap!.assets.find((a) => a.id === id)!;
  const { data, err } = useLiveFetch<RcaView>(`/api/rca/${encodeURIComponent(id)}`, 3000);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => { ctrl.current?.abort(); setTurns([]); setAiErr(null); setQ(""); }, [id]);
  useEffect(() => () => ctrl.current?.abort(), []);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "nearest" }); }, [turns]);

  const sigName = (key: string) => [...m.weekly, ...m.hourly].find((s) => s.key === key)?.name ?? key;

  const ask = async (question: string | null) => {
    if (streaming) return;
    const history = turns;
    const next: Turn[] = question ? [...history, { role: "user", content: question }, { role: "assistant", content: "" }] : [{ role: "assistant", content: "" }];
    setTurns(next);
    setQ("");
    setAiErr(null);
    setStreaming(true);
    const ac = new AbortController();
    ctrl.current = ac;
    try {
      await streamAsk(id, { question, history: question ? history : [] }, (t) => setTurns((cur) => {
        const c = cur.slice();
        c[c.length - 1] = { role: "assistant", content: c[c.length - 1].content + t };
        return c;
      }), ac.signal);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setAiErr((e as Error).message);
        setTurns((cur) => (cur.length && cur[cur.length - 1].role === "assistant" && !cur[cur.length - 1].content ? cur.slice(0, -1) : cur));
      }
    } finally {
      setStreaming(false);
    }
  };

  const copyDraft = async () => {
    if (!data) return;
    try { await navigator.clipboard.writeText(data.draft); notify("Draf laporan disalin."); } catch { notify("Tidak bisa menyalin otomatis. Pilih teks lalu salin manual."); }
  };
  const downloadDraft = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([data.draft], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `Draf-RCA-${id}-${fD(snap!.now).replace(/ /g, "")}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const options = [...meta!.assets].sort((a, b) => UNIT_ORDER.indexOf(a.plantCode) - UNIT_ORDER.indexOf(b.plantCode));
  const llm = data?.llm ?? meta!.llm;
  const hyps = data?.hypotheses ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">AI RCA Assistant</div>
          <h1 className="row" style={{ gap: 10 }}>{m.id} · {m.short} <SourceBadge source={m.source} /></h1>
          <p>Hipotesis akar masalah disusun dari data kondisi terkini, pustaka mode kegagalan per jenis aset, dan insiden serupa di database.
            Semua hanya memakai data sampai {fDT(snap!.now)}. Hasilnya titik awal investigasi, bukan kesimpulan final.</p>
        </div>
        <div className="row">
          <select className="sel" aria-label="Pilih aset" value={id} onChange={(e) => go("rca", e.target.value)}>
            {options.map((a) => <option key={a.id} value={a.id}>{a.plantCode} · {a.id} · {a.short}</option>)}
          </select>
          <button className="btn" onClick={() => go("monitor", id)}>Lihat grafik aset</button>
        </div>
      </div>

      <div className="banner" style={{ gridTemplateColumns: "auto 1fr" }}>
        <div className="row"><StatusChip status={st.status} /><Prio p={st.prio} /></div>
        <div className="why">{st.reason || (st.status === "NORMAL" ? "Aset dalam pola normal. Analisis tetap bisa dibuat sebagai pemeriksaan kondisi." : "Belum ada penyimpangan berarti.")}
          {!st.realNow && <> Data per jam saat ini adalah <span className="src dummy">isian dummy</span>; bukti kerusakan berasal dari pembacaan mingguan asli.</>}
          {data && data.dq.length > 0 && <> Sensor bermasalah: <b>{data.dq.join(", ")}</b>. Periksa instrumen sebelum menyimpulkan kerusakan mekanis.</>}</div>
      </div>

      {err && <div className="empty" style={{ marginBottom: 14 }}>Gagal memuat analisis: {err}</div>}
      {!data && !err && <div className="empty">Memuat analisis…</div>}

      {data && (
        <div className="rca-grid">
          <div className="stack">
            <Panel title="Verifikasi parameter (4P)" sub="nilai terbaru terhadap baseline dan batas">
              {data.condition.length === 0 ? <div className="empty">Belum ada pembacaan kondisi.</div> : (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead><tr><th>Parameter</th><th className="r">Nilai</th><th className="r">Baseline</th><th className="r">Δ</th><th className="r">Alarm</th><th className="r">Trip</th><th>Hasil</th></tr></thead>
                    <tbody>
                      {data.condition.map((r) => (
                        <tr key={`${r.period}-${r.key}`}>
                          <td>{r.name}<div className="xs muted">{r.period} · {fDT(r.h)}</div></td>
                          <td className="r"><b>{fv(r.value)}</b> <span className="xs muted">{r.unit}</span></td>
                          <td className="r">{fv(r.base)}</td>
                          <td className="r">{r.rel == null ? "–" : `${r.rel > 0 ? "+" : ""}${nf(r.rel * 100)}%`}</td>
                          <td className="r">{fv(r.alarm)}</td>
                          <td className="r">{fv(r.trip)}</td>
                          <td><span className={`okng ${r.result}`}>{r.result}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="note">G = dalam batas · CEK = bergeser lebih dari 10% dari baseline · NG = melewati batas alarm.</div>
            </Panel>

            <Panel title="Hipotesis akar masalah" sub="kecocokan bukti terhadap pustaka mode kegagalan (4M+1E)">
              {hyps.length === 0 ? <div className="empty">Belum ada pustaka hipotesis untuk jenis aset ini.</div> : hyps.map((h, i) => (
                <div className={`hyp${i === 0 ? " top" : ""}`} key={h.id}>
                  <div className="hh"><b>{i + 1}. {h.title}</b><span className="conf">{nf(h.score * 100)}%</span></div>
                  <div className="chips">
                    <span className="evc">mode: {h.mech}</span>
                    {h.comp.map((c) => <span className="evc" key={c}>{c}</span>)}
                  </div>
                  <div className="chips" aria-label="Bukti">
                    {h.evidence.map((e) => (
                      <span key={`${e.key}-${e.pos}`} className={`evc${e.pos && e.e >= 0.5 ? " hot" : ""}`} title="0% = di baseline, 100% = mencapai batas alarm/desain">
                        {e.pos ? "" : "melawan: "}{sigName(e.key)} {nf(e.e * 100)}%
                      </span>
                    ))}
                  </div>
                  {i < 2 && (
                    <div className="grid g2" style={{ gap: 10 }}>
                      <div><div className="xs muted">Langkah verifikasi</div><ul className="clean small">{h.checks.map((c) => <li key={c}>{c}</li>)}</ul></div>
                      <div><div className="xs muted">Usulan tindakan</div><ul className="clean small">{h.actions.map((c) => <li key={c}>{c}</li>)}</ul></div>
                    </div>
                  )}
                </div>
              ))}
            </Panel>

            <Panel title="Insiden serupa di database" sub="hanya insiden sebelum waktu simulasi" right={<SourceBadge source="real" />}>
              {data.similar.length === 0 ? <div className="empty">Tidak ada insiden serupa.</div> : (
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead><tr><th>Tanggal</th><th>Tag</th><th className="wrap">Judul</th><th>Plant</th><th>Mode</th><th>Status</th><th className="r">Loss</th><th className="r">Cocok</th></tr></thead>
                    <tbody>
                      {data.similar.map((s) => (
                        <tr key={s.id}>
                          <td className="num">{s.date}</td><td><Tag id={s.tag} /></td><td className="wrap">{s.title}</td><td>{s.plant}</td><td>{s.fm}</td>
                          <td className="xs">{s.status}</td><td className="r">{usd(s.loss)}</td><td className="r">{nf(s.score * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.lessons.length > 0 && (
                <>
                  <h4 style={{ margin: "12px 0 6px", fontSize: 15 }}>Pelajaran dari laporan RCA yang sudah terbit</h4>
                  {data.lessons.map((l) => (
                    <div className="callout" key={l.ar} style={{ marginBottom: 8 }}>
                      <div className="row" style={{ marginBottom: 4 }}><Tag id={l.tag} /><span className="mono xs">{l.ar}</span></div>
                      <div><b>Akar masalah:</b> {l.rootCause}</div>
                      <ul className="clean small" style={{ marginTop: 4 }}>{l.actions.map((a) => <li key={a}>{a}</li>)}</ul>
                    </div>
                  ))}
                </>
              )}
            </Panel>
          </div>

          <div className="stack">
            <Panel title="Analisis Claude" sub={llm.available ? `model ${llm.model}` : "belum aktif"}>
              {!llm.available ? (
                <div className="callout">
                  <b>Asisten Claude belum aktif.</b> Isi <span className="mono">ANTHROPIC_API_KEY</span> di file <span className="mono">backend/.env</span> (lihat README),
                  lalu jalankan ulang server. Tanpa itu, verifikasi parameter, hipotesis, insiden serupa dan draf laporan di halaman ini tetap berjalan.
                </div>
              ) : (
                <>
                  {turns.length === 0 && (
                    <div className="stack" style={{ gap: 8 }}>
                      <p className="small ink2">Claude membaca kondisi parameter, skor AI, hipotesis, insiden serupa dan laporan RCA terbit untuk aset ini,
                        lalu menulis analisis probable root cause dalam format ringkas.</p>
                      <div><button className="btn primary" onClick={() => ask(null)} disabled={streaming}>Buat analisis dengan Claude</button></div>
                    </div>
                  )}
                  {turns.length > 0 && (
                    <div className="grid" style={{ gap: 8, maxHeight: 620, overflowY: "auto" }}>
                      {turns.map((t, i) => t.role === "user"
                        ? <div key={i} className="bubble u">{t.content}</div>
                        : <div key={i} className="ai-out">{t.content ? <Markdown text={t.content} /> : <span className="muted">Claude sedang menganalisis…</span>}</div>)}
                      <div ref={chatEnd} />
                    </div>
                  )}
                  {aiErr && <div className="callout" style={{ marginTop: 8, borderColor: "var(--crit)" }}>{aiErr}</div>}
                  {turns.length > 0 && (
                    <form className="ask" onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(q.trim()); }}>
                      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tanya lanjutan, mis. apa yang dicek pertama di lapangan?" aria-label="Pertanyaan lanjutan" disabled={streaming} maxLength={2000} />
                      <button className="btn primary" type="submit" disabled={streaming || !q.trim()}>Kirim</button>
                      {streaming ? <button className="btn" type="button" onClick={() => ctrl.current?.abort()}>Stop</button>
                        : <button className="btn ghost" type="button" onClick={() => { setTurns([]); setAiErr(null); }}>Ulang</button>}
                    </form>
                  )}
                  <div className="note">Konteks dikirim ulang setiap pertanyaan, sesuai waktu simulasi saat itu. Jawaban AI wajib diverifikasi engineer.</div>
                </>
              )}
            </Panel>

            <Panel title="Draf abnormality report" sub="format RCA-F-0075-02" right={
              <div className="row" style={{ gap: 4 }}><button className="btn sm" onClick={copyDraft}>Salin</button><button className="btn sm" onClick={downloadDraft}>Unduh .txt</button></div>}>
              <pre className="draft">{data.draft}</pre>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
