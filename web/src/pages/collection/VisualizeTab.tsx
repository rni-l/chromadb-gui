import type { CollectionDetail, ProjectionResult } from "@shared/types";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ScatterChart as ScatterSeries } from "echarts/charts";
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { Crosshair, ScatterChart, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Empty, ErrorBox, Input, Select, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { keys } from "@/lib/queries";
import { CATEGORICAL, SEQUENTIAL, useIsDark } from "@/lib/useIsDark";
import { fmtNum, fmtScalar, metadataKeys } from "@/lib/utils";
import type { UmapMessage, UmapRequest } from "@/workers/umap.worker";
import type { CollectionCtx } from "../CollectionPage";

echarts.use([ScatterSeries, GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, DataZoomComponent, CanvasRenderer]);

type Method = "pca" | "umap";
const MAX_CATEGORIES = 8;
const OTHER = "其它";
const MISSING = "（无值）";

export function VisualizeTab({ ctx, detail }: { ctx: CollectionCtx; detail: CollectionDetail }) {
  const { cid, db, col, openRecord } = ctx;
  const [limit, setLimit] = useState(2000);
  const [method, setMethod] = useState<Method>("pca");
  const [nNeighbors, setNNeighbors] = useState(15);
  const [colorKey, setColorKey] = useState("");
  const [query, setQuery] = useState("");

  const proj = useQuery({
    queryKey: [...keys.records(cid, db, col), "projection", limit],
    queryFn: ({ signal }) => api.projection(cid, db, col, { limit, components: 32 }, signal),
    staleTime: 5 * 60_000,
    enabled: detail.count > 0,
  });
  const umap = useUmap(method === "umap" ? proj.data : undefined, nNeighbors);

  const coords = useMemo(() => {
    if (!proj.data) return null;
    if (method === "pca") return proj.data.scores.map((s) => [s[0], s[1]] as [number, number]);
    return umap.embedding;
  }, [proj.data, method, umap.embedding]);

  const keysList = useMemo(() => (proj.data ? metadataKeys(proj.data.metadatas.map((m) => ({ metadata: m })), 30) : []), [proj.data]);

  const highlight = useMutation({
    mutationFn: (text: string) => api.search(cid, db, col, { text, nResults: 20 }),
  });
  const hitIds = useMemo(() => new Set(highlight.data?.hits.map((h) => h.id) ?? []), [highlight.data]);
  const hitsInSample = proj.data ? proj.data.ids.filter((id) => hitIds.has(id)).length : 0;

  if (!detail.count) return <Empty icon={<ScatterChart />} title="集合是空的">写入一些记录后再来看向量分布。</Empty>;

  const ev = proj.data?.explainedVariance ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
        <Control label="降维">
          <div className="inline-grid grid-cols-2 gap-0.5 rounded-md bg-sunken p-0.5">
            {(["pca", "umap"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMethod(m)}
                className={`h-6 rounded px-2.5 text-xs font-medium ${method === m ? "bg-panel text-fg shadow-sm" : "text-muted"}`}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>
        </Control>
        {method === "umap" ? (
          <Control label="邻居数">
            <Select aria-label="邻居数" value={nNeighbors} onChange={(e) => setNNeighbors(Number(e.target.value))} className="h-7 w-16 text-xs">
              {[5, 10, 15, 30, 50].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </Select>
          </Control>
        ) : null}
        <Control label="采样">
          <Select aria-label="采样数" value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="h-7 w-24 text-xs">
            {[500, 1000, 2000, 5000, 10000].map((n) => (
              <option key={n} value={n}>
                {fmtNum(n)}
              </option>
            ))}
          </Select>
        </Control>
        <Control label="着色">
          <Select aria-label="着色字段" value={colorKey} onChange={(e) => setColorKey(e.target.value)} className="h-7 w-40 text-xs">
            <option value="">不着色</option>
            {keysList.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </Control>
        <form
          className="flex min-w-64 flex-1 items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) highlight.mutate(query.trim());
          }}
        >
          <div className="relative flex-1">
            <Crosshair className="pointer-events-none absolute top-1.5 left-2 size-4 text-subtle" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={detail.embedding.profileId ? "输入文本，高亮最相近的 20 条" : "未配置 Embedding，无法文本高亮"}
              disabled={!detail.embedding.profileId}
              className="h-7 pl-8 text-xs"
            />
          </div>
          {highlight.data ? (
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => (highlight.reset(), setQuery(""))} aria-label="清除高亮">
              <X />
            </Button>
          ) : null}
          <Button type="submit" size="sm" loading={highlight.isPending} disabled={!query.trim()}>
            高亮
          </Button>
        </form>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 bg-sunken px-4 py-1.5 text-[11.5px] text-muted">
        {proj.data ? (
          <>
            <span>
              采样 <b className="text-fg tabular-nums">{fmtNum(proj.data.sampled)}</b> / {fmtNum(proj.data.total)} 条
              {proj.data.sampled < proj.data.total ? "（等距分段抽样）" : ""}
            </span>
            <span>{proj.data.dimension} 维</span>
            {method === "pca" ? (
              <span>
                PC1 {(ev[0] * 100).toFixed(1)}% · PC2 {(ev[1] * 100).toFixed(1)}% · 两维共解释 {((ev[0] + ev[1]) * 100).toFixed(1)}% 方差
              </span>
            ) : (
              <span>UMAP 输入：前 {proj.data.scores[0]?.length ?? 0} 个主成分（{(ev.reduce((a, b) => a + b, 0) * 100).toFixed(1)}% 方差）</span>
            )}
            {highlight.data ? (
              <span className="text-accent-text">
                高亮 {hitsInSample} / {highlight.data.hits.length} 条命中（其余不在采样中）
              </span>
            ) : null}
          </>
        ) : (
          <span>正在拉取向量并计算 PCA…</span>
        )}
        <span className="ml-auto text-subtle">滚轮缩放 · 拖拽平移 · 点击点查看记录 · 点图例单独显示</span>
      </div>

      <div className="relative min-h-0 flex-1">
        {proj.isLoading || (method === "umap" && umap.running) ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[color-mix(in_srgb,var(--bg)_70%,transparent)]">
            <Spinner className="size-6" />
            {method === "umap" && umap.running ? (
              <div className="w-56">
                <div className="mb-1 text-center text-xs text-muted">UMAP 计算中 {Math.round(umap.progress * 100)}%</div>
                <div className="h-1 overflow-hidden rounded-full bg-sunken">
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${umap.progress * 100}%` }} />
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted">拉取向量并计算 PCA…</div>
            )}
          </div>
        ) : null}
        {proj.error || umap.error ? (
          <div className="p-4">
            <ErrorBox error={proj.error ?? umap.error} />
          </div>
        ) : null}
        {proj.data && coords ? <Plot data={proj.data} coords={coords} colorKey={colorKey} hitIds={hitIds} onPick={openRecord} /> : null}
      </div>
    </div>
  );
}

// A div, not a <label>: a label would forward clicks to its first control,
// which turns the PCA/UMAP segmented buttons into a single PCA button.
function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <span className="text-xs text-muted">{label}</span>
      {children}
    </div>
  );
}

function useUmap(data: ProjectionResult | undefined, nNeighbors: number) {
  const [state, setState] = useState<{ embedding: [number, number][] | null; progress: number; running: boolean; error: string | null }>({
    embedding: null,
    progress: 0,
    running: false,
    error: null,
  });
  useEffect(() => {
    if (!data) return;
    const worker = new Worker(new URL("../../workers/umap.worker.ts", import.meta.url), { type: "module" });
    setState({ embedding: null, progress: 0, running: true, error: null });
    worker.onmessage = (e: MessageEvent<UmapMessage>) => {
      const m = e.data;
      if (m.type === "progress") setState((s) => ({ ...s, progress: m.epoch / m.total }));
      else if (m.type === "done") setState({ embedding: m.embedding as [number, number][], progress: 1, running: false, error: null });
      else setState((s) => ({ ...s, running: false, error: m.message }));
    };
    const req: UmapRequest = { data: data.scores, nNeighbors, minDist: 0.1 };
    worker.postMessage(req);
    return () => worker.terminate();
  }, [data, nNeighbors]);
  return state;
}

interface Point {
  value: [number, number];
  idx: number;
}

function Plot({
  data,
  coords,
  colorKey,
  hitIds,
  onPick,
}: {
  data: ProjectionResult;
  coords: [number, number][];
  colorKey: string;
  hitIds: Set<string>;
  onPick: (id: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const dark = useIsDark();
  // Refs keep the click handler (bound once) pointed at the latest props.
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const idsRef = useRef(data.ids);
  idsRef.current = data.ids;

  useEffect(() => {
    const c = echarts.init(el.current!, undefined, { renderer: "canvas" });
    chart.current = c;
    c.on("click", (p) => {
      const idx = (p.data as Point | undefined)?.idx;
      if (idx !== undefined) pickRef.current(idsRef.current[idx]);
    });
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      c.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    const palette = dark ? CATEGORICAL.dark : CATEGORICAL.light;
    const surface = v("--panel");
    const muted = v("--fg-muted");
    const subtle = v("--fg-subtle");
    const border = v("--border");
    const size = data.ids.length > 5000 ? 6 : 8;

    const values = colorKey ? data.metadatas.map((m) => m?.[colorKey]) : [];
    const present = values.filter((x) => x !== undefined && x !== null);
    const numeric = colorKey && present.length > 0 && present.every((x) => typeof x === "number");

    // Group points into series; categorical keeps a fixed slot per value (by frequency).
    const groups = new Map<string, Point[]>();
    let catColor: Record<string, string> = {};
    if (colorKey && !numeric) {
      const freq = new Map<string, number>();
      for (const x of values) {
        const k = x === undefined || x === null ? MISSING : fmtScalar(x);
        freq.set(k, (freq.get(k) ?? 0) + 1);
      }
      const ranked = [...freq.entries()].filter(([k]) => k !== MISSING).sort((a, b) => b[1] - a[1]);
      const top = ranked.slice(0, MAX_CATEGORIES).map(([k]) => k);
      catColor = Object.fromEntries(top.map((k, i) => [k, palette[i]]));
      for (const k of top) groups.set(k, []);
      if (ranked.length > MAX_CATEGORIES) groups.set(OTHER, []);
      if (freq.has(MISSING)) groups.set(MISSING, []);
      coords.forEach((xy, idx) => {
        const x = values[idx];
        const k = x === undefined || x === null ? MISSING : fmtScalar(x);
        groups.get(catColor[k] ? k : k === MISSING ? MISSING : OTHER)!.push({ value: xy, idx });
      });
    } else {
      groups.set("全部", coords.map((xy, idx) => ({ value: xy, idx })));
    }

    const neutral = dark ? "#6f6862" : "#a39a92";
    const series: echarts.EChartsCoreOption[] = [...groups.entries()].map(([name, pts]) => ({
      type: "scatter",
      name,
      data: numeric
        ? pts.map((p) => ({ ...p, value: [...p.value, (values[p.idx] as number) ?? NaN] }))
        : pts,
      symbolSize: size,
      large: pts.length > 4000,
      itemStyle: {
        color: numeric ? undefined : (catColor[name] ?? (colorKey ? neutral : palette[0])),
        opacity: hitIds.size ? 0.25 : 0.8,
        borderColor: surface,
        borderWidth: pts.length > 4000 ? 0 : 1,
      },
      emphasis: { scale: 1.6, itemStyle: { opacity: 1 } },
    }));

    // Search hits on top: larger, orange slot, with a surface ring.
    if (hitIds.size) {
      const hits = coords.flatMap((xy, idx) => (hitIds.has(data.ids[idx]) ? [{ value: xy, idx }] : []));
      series.push({
        type: "scatter",
        name: "检索命中",
        data: hits,
        symbolSize: 13,
        z: 10,
        itemStyle: { color: palette[1], borderColor: surface, borderWidth: 2, opacity: 1 },
        emphasis: { scale: 1.3 },
      });
    }

    const showLegend = groups.size > 1 || hitIds.size > 0;
    const seq = dark ? SEQUENTIAL.dark : SEQUENTIAL.light;
    const nums = numeric ? (present as number[]) : [];

    chart.current?.setOption(
      {
        animation: false,
        backgroundColor: "transparent",
        grid: { left: 40, right: numeric ? 90 : showLegend ? 170 : 24, top: 20, bottom: 36 },
        xAxis: { type: "value", scale: true, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: border } }, axisLabel: { color: subtle, fontSize: 10 } },
        yAxis: { type: "value", scale: true, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: border } }, axisLabel: { color: subtle, fontSize: 10 } },
        dataZoom: [
          { type: "inside", xAxisIndex: 0, filterMode: "none" },
          { type: "inside", yAxisIndex: 0, filterMode: "none" },
        ],
        legend: showLegend && !numeric
          ? {
              type: "scroll",
              orient: "vertical",
              right: 8,
              top: 20,
              bottom: 20,
              itemWidth: 10,
              itemHeight: 10,
              textStyle: { color: muted, fontSize: 11, width: 130, overflow: "truncate" },
              pageTextStyle: { color: muted },
            }
          : { show: false },
        visualMap: numeric
          ? {
              type: "continuous",
              dimension: 2,
              min: Math.min(...nums),
              max: Math.max(...nums),
              seriesIndex: [...groups.keys()].map((_, i) => i),
              inRange: { color: seq },
              right: 8,
              top: "middle",
              calculable: true,
              itemHeight: 160,
              text: [colorKey, ""],
              textStyle: { color: muted, fontSize: 11 },
            }
          : undefined,
        tooltip: {
          trigger: "item",
          confine: true,
          backgroundColor: v("--panel"),
          borderColor: border,
          textStyle: { color: v("--fg"), fontSize: 12 },
          extraCssText: "max-width:360px;white-space:normal;box-shadow:var(--shadow);border-radius:8px;",
          formatter: (p: { data: Point; seriesName: string; color: string }) => {
            const i = p.data.idx;
            const doc = data.documents[i];
            const meta = data.metadatas[i];
            const metaHtml = meta
              ? Object.entries(meta)
                  .slice(0, 6)
                  .map(([k, val]) => `<span style="color:${muted}">${esc(k)}</span>: ${esc(fmtScalar(val))}`)
                  .join("<br/>")
              : "";
            return `<div style="font-family:var(--font-mono);font-size:11px;color:${muted};margin-bottom:4px">${esc(data.ids[i])}</div>
              ${doc ? `<div style="line-height:1.5;margin-bottom:6px">${esc(doc.slice(0, 220))}${doc.length > 220 ? "…" : ""}</div>` : ""}
              <div style="font-size:11px;line-height:1.6">${metaHtml}</div>`;
          },
        },
        series,
      },
      { notMerge: true },
    );
  }, [data, coords, colorKey, hitIds, dark]);

  return <div ref={el} className="absolute inset-0" />;
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
