import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, MarkLineComponent, MarkAreaComponent, CanvasRenderer]);

export function EChart({ option, height = 180, label }: { option: EChartsCoreOption; height?: number; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!el.current) return;
    inst.current = echarts.init(el.current, undefined, { renderer: "canvas" });
    const ro = new ResizeObserver(() => inst.current?.resize());
    ro.observe(el.current);
    return () => { ro.disconnect(); inst.current?.dispose(); inst.current = null; };
  }, []);
  useEffect(() => { inst.current?.setOption(option, { notMerge: true, lazyUpdate: true }); }, [option]);
  return <div ref={el} style={{ height, width: "100%" }} role="img" aria-label={label} />;
}
