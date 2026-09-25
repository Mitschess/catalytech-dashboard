// Types mirror the FastAPI responses (backend/app/engine.py and main.py).
export type Status = "NODATA" | "NORMAL" | "WATCH" | "ALARM" | "CRITICAL" | "TRIP" | "MAINT" | "PULIH";
export type Mode = "reality" | "auto" | "manual";
export type Source = "real" | "dummy";

export interface SignalDef { key: string; name: string; unit: string; alarm: number | null; trip: number | null; dir: number; mspc: boolean; normBy: string | null }
export interface AssetMeta {
  id: string; name: string; short: string; eqType: string; typeCode: string; cls: string; plantCode: string; plant: string;
  disc: string; crit: string; pic: string; spare: string; source: Source; lossPerH: number; tripHours: number; tripLoss: number;
  plannedLoss: number; plannedH: number; plannedAction: string; hourly: SignalDef[]; weekly: SignalDef[];
  hourlyWindow: [number, number] | null; weeklyWindow: [number, number] | null; scenario: string; ar: string | null;
  oldPreRisk: string | null; oldScore: number | null; tripStart: number | null;
}
export interface AssetState {
  id: string; source: Source; status: Status; prio: string; health: number | null; reason: string; layer: string; predH: number | null;
  alertId: string | null; mspc: { state: "ready" | "training" | "waiting"; progress: number; ratio: number | null };
  dq: string[] | null; realNow: boolean; lastDataH: number | null; healthTrend: (number | null)[]; scheduledH: number | null;
}
export interface Alert {
  id: string; assetId: string; source: Source; raisedH: number; level: number; levelH: number; reason: string; layer: string; open: boolean;
  outcome: "trip" | "planned" | null; closedH: number | null; prio: string; status: Status; predH: number | null; p: number; varUsd: number;
  dueH: number; ack: { h: number; by: string } | null; woId: number | null; woStatus: string | null; overdue: boolean; owner: string; disc: string;
  tripLoss: number; oldScore: number | null; oldPreRisk: string | null; scheduledH: number | null; first: Record<string, number>;
}
export interface EventItem { h: number; assetId: string; source: Source; type: string; prio: string; text: string; layer: string }
export interface LossBlock { realityNow: number; scenarioNow: number; realityEnd: number; scenarioEnd: number }
export interface Kpis {
  alerts: { P1: number; P2: number; P3: number }; varUsd: number; overdue: number; losses: LossBlock;
  assets: number; models: { ready: number; total: number };
}
export interface Snapshot {
  now: number; nowIso: string; running: boolean; speed: number; mode: Mode; pauseOnAlert: boolean; epoch: number;
  assets: AssetState[]; alerts: Alert[]; events: EventItem[]; kpis: Kpis;
}
export interface IncidentSummary {
  n: number; totalLoss: number; downtime: number; openLoss: number; openN: number; rcaStage: number; rcaOverdue: number; overdueMedianDays: number;
  spearman: number; byMechanism: { k: string; v: number }[]; byPlant: { k: string; v: number }[]; byMonth: { k: string; v: number; n: number }[];
  byStatus: { k: string; n: number; loss: number }[];
  backlog: { id: number; tag: string; title: string; plant: string; status: string; prerisk: string; score: number; loss: number; overdueDays: number | null }[];
}
export interface Meta {
  simStart: string; nHours: number; speeds: number[]; defaultStart: number; slaHours: Record<string, number>; assets: AssetMeta[];
  llm: { available: boolean; model: string }; incidents: IncidentSummary;
}
/** real[i] = 1 when hour h[i] holds real competition data, 0 when it is the labelled DUMMY fill. */
export interface Samples { assetId: string; h: number[]; values: (number | null)[][]; t2: (number | null)[]; spe: (number | null)[]; ratio: (number | null)[]; code: number[]; health: (number | null)[]; real: number[] }
export interface Pred { k: number; h: number; coef: number[]; last_h: number; period_h: number }
export interface History {
  assetId: string; h: number[]; values: (number | null)[][]; t2: (number | null)[]; spe: (number | null)[]; ratio: (number | null)[]; code: number[];
  health: (number | null)[]; real: number[];
  model: { ready: boolean; progress: number; trainedRange: [number, number] | null; nTrain: number; realShare: number | null; n?: number; k?: number; p?: number; explained?: number; limT2?: number; limSPE?: number };
  hrBase: number[] | null; cm: { h: number; v: number[]; level: number; health: number; real: boolean }[]; cmBase: number[] | null; cmPreds: Pred[]; hrPreds: Pred[];
  contrib: { h: number; stat: string; ratio: number; keys: string[]; values: number[] } | null; events: EventItem[]; trip: { kind: string; h: number; loss: number } | null;
}

export interface WorkOrder { id: number; alertId: string | null; assetId: string; title: string; prio: string; owner: string; createdH: number; dueH: number | null; status: "Open" | "Dikerjakan" | "Selesai"; updatedH: number | null; source: Source }
export interface AlertsResp { now: number; alerts: Alert[]; workorders: WorkOrder[]; kpis: Kpis }
export interface CapaRow { assetId: string; ar: string; rc: string; action: string; date: string; pic: string; status: string; kind: string; dueH: number; state: "Closed" | "Terlambat" | "Dalam jadwal"; days: number }
export interface ModelRow {
  assetId: string; source: Source; ready: boolean; progress: number; nTrain: number; trainedRange: [number, number] | null; realShare: number | null; scored: number; anomalyHours: number;
  lastRatio: number | null; keys: string[]; info: { n?: number; k?: number; p?: number; explained?: number; limT2?: number; limSPE?: number };
}
export interface CondRow { key: string; name: string; unit: string; value: number; base: number | null; alarm: number | null; trip: number | null; rel: number | null; result: "G" | "CEK" | "NG"; period: string; h: number }
export interface Hypothesis { id: string; title: string; mech: string; comp: string[]; checks: string[]; actions: string[]; score: number; evidence: { key: string; e: number; pos: boolean }[] }
export interface SimilarInc { score: number; id: number; tag: string; title: string; plant: string; type: string; comp: string; fm: string; date: string; status: string; loss: number }
export interface RcaView {
  assetId: string; now: number; status: Status; condition: CondRow[]; hypotheses: Hypothesis[]; similar: SimilarInc[];
  lessons: { ar: string; tag: string; rootCause: string; actions: string[] }[]; draft: string; dq: string[]; llm: { available: boolean; model: string };
}

export async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
  return r.json();
}
export async function send<T = unknown>(path: string, method = "POST", body?: unknown): Promise<T> {
  const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
  return data as T;
}

// ---------- time & number formatting (Indonesian) ----------
const MON = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
let START_MS = Date.UTC(2025, 9, 23);
export function setSimStart(iso: string) { START_MS = Date.parse(iso + "Z"); }
export const hToMs = (h: number) => START_MS + h * 3600e3;
export const msToH = (ms: number) => Math.round((ms - START_MS) / 3600e3);
export function fD(h: number | null | undefined): string {
  if (h == null) return "–";
  const d = new Date(hToMs(h));
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function fDs(h: number | null | undefined): string {
  if (h == null) return "–";
  const d = new Date(hToMs(h));
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}
export function fDT(h: number | null | undefined): string {
  if (h == null) return "–";
  const d = new Date(hToMs(h));
  return `${fD(h)} ${String(d.getUTCHours()).padStart(2, "0")}:00`;
}
export function fHour(h: number): string { return String(new Date(hToMs(h)).getUTCHours()).padStart(2, "0") + ":00"; }
export const nf = (v: number, dec = 0) => Number(v).toLocaleString("id-ID", { minimumFractionDigits: dec, maximumFractionDigits: dec });
export function fv(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "–";
  const a = Math.abs(v);
  return nf(v, a < 2 ? 3 : a < 20 ? 2 : a < 200 ? 1 : 0);
}
export function usd(k: number | null | undefined): string {
  if (k == null || Number.isNaN(k)) return "–";
  const a = Math.abs(k), s = k < 0 ? "−" : "";
  if (a < 0.05) return "US$0";
  if (a >= 1000) return `${s}US$${nf(a / 1000, a >= 10000 ? 1 : 2)} jt`;
  return `${s}US$${nf(a, a < 10 ? 1 : 0)} rb`;
}
export const days = (from: number, to: number) => Math.round((to - from) / 24);
export const STATUS_RANK: Record<Status, number> = { TRIP: 6, CRITICAL: 5, ALARM: 4, MAINT: 3, WATCH: 2, PULIH: 1, NORMAL: 0, NODATA: -1 };
export const STATUS_LABEL: Record<string, string> = { NODATA: "Belum ada data", NORMAL: "Normal", WATCH: "Watch", ALARM: "Alarm", CRITICAL: "Critical", TRIP: "Trip", MAINT: "Intervensi", PULIH: "Pulih", DATA: "Kualitas data", MODEL: "Model AI" };
export const MODE_LABEL: Record<Mode, string> = { reality: "Kenyataan", auto: "SIGAP otomatis", manual: "Manual" };
export function cssVar(name: string): string { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

/** Units in process order, as drawn in the site schematic and the sidebar. */
export const UNIT_ORDER = ["ZCU", "OPP", "ARP", "NUP"];
