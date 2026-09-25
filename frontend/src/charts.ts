import type { EChartsCoreOption } from "echarts/core";
import { cssVar, fDT, fDs, fv, hToMs, msToH, nf } from "./api";

export interface Ref { y: number; label: string; color: string; dashed?: boolean }
export interface Band { from: number; to: number; color: string; label?: string }
export interface Line { name: string; h: number[]; v: (number | null)[]; color: string; dashed?: boolean; width?: number; area?: boolean; symbol?: boolean }

/** "#rrggbb" + opacity -> rgba(); used for shaded bands drawn from theme tokens. */
export function alpha(hex: string, a: number): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})` : hex;
}

/** Points of a quadratic trend fitted on the last 8 period values (x = 0..7, x = 7 at last_h), extended to `to`. */
export function projection(p: { coef: number[]; last_h: number; period_h: number }, to: number): { h: number[]; v: number[] } {
  const h: number[] = [], v: number[] = [];
  for (let hh = p.last_h; hh <= to; hh += p.period_h) {
    const x = 7 + (hh - p.last_h) / p.period_h;
    h.push(hh);
    v.push(p.coef[0] * x * x + p.coef[1] * x + p.coef[2]);
  }
  return { h, v };
}

const base = () => ({
  ink3: cssVar("--ink-3") || "#6d7977", line: cssVar("--line") || "#d3d9d7", ink: cssVar("--ink") || "#172023",
  surface: cssVar("--surface") || "#f7f8f7", ink2: cssVar("--ink-2") || "#485457",
});

/** Time-series line chart with limit lines, shaded bands and a "now" marker. X values are simulated hours. */
export function timeChart(o: {
  lines: Line[]; refs?: Ref[]; bands?: Band[]; now?: number; x0: number; x1: number; unit?: string; log?: boolean;
  yMin?: number; yMax?: number; grid?: { left?: number; right?: number; top?: number; bottom?: number };
}): EChartsCoreOption {
  const c = base();
  const series = o.lines.map((l, i) => ({
    type: "line", name: l.name, showSymbol: !!l.symbol, symbolSize: 5, connectNulls: false, animation: false,
    data: l.h.map((h, k) => [hToMs(h), l.v[k]]),
    lineStyle: { color: l.color, width: l.width ?? 2, type: l.dashed ? "dashed" : "solid" }, itemStyle: { color: l.color },
    areaStyle: l.area ? { color: l.color, opacity: 0.08 } : undefined,
    markLine: i === 0 ? {
      silent: true, symbol: "none", animation: false,
      data: [
        ...(o.refs ?? []).map((r) => ({ yAxis: r.y, lineStyle: { color: r.color, width: 1.2, type: r.dashed ? "dashed" : "solid" },
          label: { formatter: r.label, position: "insideEndTop", color: c.ink2, fontSize: 10 } })),
        ...(o.now != null && o.now >= o.x0 && o.now <= o.x1 ? [{ xAxis: hToMs(o.now), lineStyle: { color: c.ink, width: 1, opacity: 0.5, type: "solid" }, label: { show: false } }] : []),
      ],
    } : undefined,
    markArea: i === 0 && o.bands?.length ? {
      silent: true, animation: false,
      data: o.bands.map((b) => [{ xAxis: hToMs(b.from), itemStyle: { color: b.color }, label: { show: !!b.label, formatter: b.label, color: c.ink2, fontSize: 10, position: "insideTopLeft" } }, { xAxis: hToMs(b.to) }]),
    } : undefined,
  }));
  return {
    animation: false,
    grid: { left: o.grid?.left ?? 46, right: o.grid?.right ?? 14, top: o.grid?.top ?? 14, bottom: o.grid?.bottom ?? 24, containLabel: false },
    xAxis: { type: "time", min: hToMs(o.x0), max: hToMs(o.x1), splitNumber: 4, axisLine: { lineStyle: { color: c.line } }, axisTick: { show: false },
      axisLabel: { color: c.ink3, fontSize: 10, hideOverlap: true, formatter: (v: number) => fDs(msToH(v)) }, splitLine: { show: false } },
    yAxis: { type: o.log ? "log" : "value", scale: !o.log, min: o.yMin, max: o.yMax, axisLine: { show: false },
      axisLabel: { color: c.ink3, fontSize: 10, formatter: (v: number) => (o.log ? nf(v, v >= 1 ? 0 : v >= 0.1 ? 1 : 2) : fv(v)) },
      splitLine: { lineStyle: { color: c.line } } },
    tooltip: {
      trigger: "axis", backgroundColor: c.ink, borderWidth: 0, textStyle: { color: c.surface, fontSize: 12 },
      axisPointer: { type: "line", lineStyle: { color: c.ink3 } },
      formatter: (ps: { axisValue: number; seriesName: string; value: [number, number | null]; color: string }[]) => {
        if (!ps.length) return "";
        const head = `<b>${fDT(msToH(ps[0].axisValue))}</b>`;
        return head + ps.filter((p) => p.value[1] != null).map((p) => `<br/><span style="color:${p.color}">●</span> ${p.seriesName}: <b>${fv(p.value[1] as number)}</b>${o.unit ? " " + o.unit : ""}`).join("");
      },
    },
    series,
  };
}

/** Horizontal bar chart (used for contributions and Pareto views). */
export function hBars(o: { labels: string[]; values: number[]; colors?: string[]; fmt?: (v: number) => string; left?: number }): EChartsCoreOption {
  const c = base();
  const fmt = o.fmt ?? ((v: number) => nf(v));
  return {
    animation: false,
    grid: { left: o.left ?? 120, right: 70, top: 4, bottom: 4 },
    xAxis: { type: "value", show: false },
    yAxis: { type: "category", data: o.labels, inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: c.ink2, fontSize: 11 } },
    tooltip: { trigger: "item", backgroundColor: c.ink, borderWidth: 0, textStyle: { color: c.surface, fontSize: 12 }, formatter: (p: { name: string; value: number }) => `${p.name}: <b>${fmt(p.value)}</b>` },
    series: [{
      type: "bar", barMaxWidth: 16, data: o.values.map((v, i) => ({ value: v, itemStyle: { color: o.colors?.[i] ?? cssVar("--s1"), borderRadius: [0, 4, 4, 0] } })),
      label: { show: true, position: "right", color: c.ink2, fontSize: 11, formatter: (p: { value: number }) => fmt(p.value) },
    }],
  };
}

/** Vertical bars with an optional line overlay (monthly loss). */
export function vBars(o: { labels: string[]; values: number[]; line?: (number | null)[]; fmt?: (v: number) => string; lineName?: string }): EChartsCoreOption {
  const c = base();
  const fmt = o.fmt ?? ((v: number) => nf(v));
  return {
    animation: false,
    grid: { left: 40, right: 10, top: 12, bottom: 24 },
    xAxis: { type: "category", data: o.labels, axisLine: { lineStyle: { color: c.line } }, axisTick: { show: false }, axisLabel: { color: c.ink3, fontSize: 10, interval: "auto" } },
    yAxis: { type: "value", axisLabel: { color: c.ink3, fontSize: 10 }, splitLine: { lineStyle: { color: c.line } } },
    tooltip: { trigger: "axis", backgroundColor: c.ink, borderWidth: 0, textStyle: { color: c.surface, fontSize: 12 },
      formatter: (ps: { axisValue: string; seriesName: string; value: number }[]) => `<b>${ps[0].axisValue}</b>` + ps.map((p) => `<br/>${p.seriesName}: <b>${p.value == null ? "–" : fmt(p.value)}</b>`).join("") },
    series: [
      { type: "bar", name: "Kerugian", barMaxWidth: 18, data: o.values, itemStyle: { color: cssVar("--s1"), borderRadius: [4, 4, 0, 0] } },
      ...(o.line ? [{ type: "line", name: o.lineName ?? "Rata-rata", data: o.line, showSymbol: false, lineStyle: { color: cssVar("--s2"), width: 2 }, itemStyle: { color: cssVar("--s2") } }] : []),
    ],
  };
}
