import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AssetMeta, EventItem, getJSON, Meta, Samples, send, setSimStart, Snapshot } from "./api";

type Conn = "connecting" | "open" | "closed";
export interface Toast { id: number; ev: EventItem }
/** Why the simulation stopped by itself: the alert that triggered "pause on alert". */
export interface PauseInfo { h: number; ev: EventItem | null }
interface LiveCtx {
  meta: Meta | null;
  snap: Snapshot | null;
  conn: Conn;
  busy: string | null;
  assetMeta: (id: string) => AssetMeta | undefined;
  control: (action: string, value?: unknown) => Promise<void>;
  subscribe: (assetId: string | null) => void;
  onSamples: (fn: (s: Samples) => void) => () => void;
  toasts: Toast[];
  pauseInfo: PauseInfo | null;
  dismiss: (id: number) => void;
  refresh: () => Promise<void>;
  notify: (text: string) => void;
}
const Ctx = createContext<LiveCtx | null>(null);
export const useLive = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLive outside LiveProvider");
  return c;
};

const TOAST_TYPES = new Set(["ALARM", "CRITICAL", "TRIP", "MAINT", "DATA"]);
const STOPPERS = new Set(["ALARM", "CRITICAL", "TRIP", "MAINT"]);   // same list as the engine's pause-on-alert
let toastId = 0;

export function LiveProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [conn, setConn] = useState<Conn>("connecting");
  const [busy, setBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pauseInfo, setPauseInfo] = useState<PauseInfo | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const subRef = useRef<string | null>(null);
  const listeners = useRef(new Set<(s: Samples) => void>());

  const pushToasts = useCallback((evs: EventItem[]) => {
    const add = evs.filter((e) => TOAST_TYPES.has(e.type) && !(e.type === "DATA" && e.prio === "-")).slice(-3).map((ev) => ({ id: ++toastId, ev }));
    if (!add.length) return;
    setToasts((t) => [...add.reverse(), ...t].slice(0, 4));
    add.forEach((x) => setTimeout(() => setToasts((t) => t.filter((y) => y.id !== x.id)), 7000));
  }, []);

  // Load the static metadata once the server answers (also when the page was opened before the server was up).
  useEffect(() => {
    if (meta || conn !== "open") return;
    let stop = false;
    getJSON<Meta>("/api/meta").then((m) => { if (!stop) { setSimStart(m.simStart); setMeta(m); } }).catch(() => {});
    return () => { stop = true; };
  }, [conn, meta]);

  useEffect(() => {
    let stop = false, retry = 0, timer: number | undefined;
    const open = () => {
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      wsRef.current = ws;
      setConn("connecting");
      ws.onopen = () => {
        retry = 0;
        setConn("open");
        if (subRef.current) ws.send(JSON.stringify({ type: "subscribe", assetId: subRef.current }));
      };
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.type === "snapshot") {
          const { type: _t, ...s } = msg;
          setSnap(s as Snapshot);
          if (s.running) setPauseInfo(null);
        } else if (msg.type === "tick") {
          const { type: _t, newEvents, samples, paused, ...rest } = msg;
          if (paused != null) {
            const ev = [...((newEvents ?? []) as EventItem[])].reverse().find((e) => STOPPERS.has(e.type)) ?? null;
            setPauseInfo({ h: paused, ev });
          } else if (rest.running) setPauseInfo(null);
          setSnap((prev) => ({ ...(prev as Snapshot), ...rest, events: [...(prev?.events ?? []), ...(newEvents as EventItem[])].slice(-300) }));
          if (newEvents?.length) pushToasts(newEvents);
          if (samples) listeners.current.forEach((fn) => fn(samples as Samples));
        }
      };
      ws.onclose = () => {
        setConn("closed");
        if (!stop) timer = window.setTimeout(open, Math.min(5000, 800 * 2 ** retry++));
      };
    };
    open();
    return () => { stop = true; clearTimeout(timer); wsRef.current?.close(); };
  }, [pushToasts]);

  const control = useCallback(async (action: string, value?: unknown) => {
    const slow = ["seek", "mode", "reset"].includes(action);
    if (["play", "seek", "mode", "reset", "step"].includes(action)) setPauseInfo(null);
    if (slow) setBusy(action === "mode" ? "Menghitung ulang skenario…" : "Memutar ulang data…");
    try { await send("/api/sim/control", "POST", { action, value }); } finally { if (slow) setBusy(null); }
  }, []);
  const subscribe = useCallback((assetId: string | null) => {
    subRef.current = assetId;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "subscribe", assetId }));
  }, []);
  const onSamples = useCallback((fn: (s: Samples) => void) => {
    listeners.current.add(fn);
    return () => { listeners.current.delete(fn); };
  }, []);
  const refresh = useCallback(async () => { setSnap(await getJSON<Snapshot>("/api/state")); }, []);
  const notify = useCallback((text: string) => {
    const t = { id: ++toastId, ev: { h: snap?.now ?? 0, assetId: "", source: "real" as const, type: "INFO", prio: "-", text, layer: "" } };
    setToasts((x) => [t, ...x].slice(0, 4));
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== t.id)), 5000);
  }, [snap?.now]);
  const byId = useMemo(() => new Map((meta?.assets ?? []).map((a) => [a.id, a])), [meta]);
  const value: LiveCtx = {
    meta, snap, conn, busy, assetMeta: (id) => byId.get(id), control, subscribe, onSamples, toasts, pauseInfo,
    dismiss: (id) => setToasts((t) => t.filter((x) => x.id !== id)), refresh, notify,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** GET a JSON endpoint and keep it in step with the simulation: reload on every clock change while paused,
 *  every `everyMs` while running, and after a replay (new epoch). Only the latest response is applied. */
export function useLiveFetch<T>(path: string | null, everyMs = 2000) {
  const { snap } = useLive();
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const my = ++seq.current;
    try {
      const d = await getJSON<T>(path);
      if (my === seq.current) { setData(d); setErr(null); }
    } catch (e) {
      if (my === seq.current) setErr((e as Error).message);
    }
  }, [path]);
  const running = snap?.running, now = snap?.now, epoch = snap?.epoch;
  useEffect(() => { setData(null); }, [path, epoch]);
  useEffect(() => { if (!running) load(); }, [load, now, running, epoch]);
  useEffect(() => {
    if (!running) return;
    load();
    const t = window.setInterval(load, everyMs);
    return () => clearInterval(t);
  }, [load, running, everyMs]);
  return { data, err, reload: load };
}
