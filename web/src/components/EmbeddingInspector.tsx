import { Copy } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { copyText, l2norm } from "@/lib/utils";
import { Button } from "./ui";

/**
 * Shows a vector as a heat strip (one cell per dimension, diverging around 0)
 * plus a value histogram and summary stats.
 */
export function EmbeddingInspector({ embedding }: { embedding: number[] }) {
  const stats = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let zeros = 0;
    for (const v of embedding) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      if (v === 0) zeros++;
    }
    return { min, max, mean: sum / embedding.length, norm: l2norm(embedding), zeros };
  }, [embedding]);

  const cells = [
    ["维度", embedding.length],
    ["L2 范数", stats.norm.toFixed(4)],
    ["均值", stats.mean.toFixed(5)],
    ["最小", stats.min.toFixed(4)],
    ["最大", stats.max.toFixed(4)],
    ["零值", stats.zeros],
  ] as const;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
        {cells.map(([k, v]) => (
          <div key={k} className="bg-panel px-3 py-2">
            <div className="text-[10.5px] text-subtle">{k}</div>
            <div className="font-mono text-[13px] tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <HeatStrip values={embedding} absMax={Math.max(Math.abs(stats.min), Math.abs(stats.max)) || 1} />
      <Histogram values={embedding} min={stats.min} max={stats.max} />
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-sunken px-2 py-1 font-mono text-[11px] text-muted">
          [{embedding.slice(0, 6).map((v) => v.toFixed(4)).join(", ")}, …]
        </code>
        <Button
          size="sm"
          variant="outline"
          onClick={() => copyText(JSON.stringify(embedding)).then(() => toast.success("向量已复制"))}
        >
          <Copy /> 复制向量
        </Button>
      </div>
    </div>
  );
}

function HeatStrip({ values, absMax }: { values: number[]; absMax: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cols = 64;
  const rows = Math.ceil(values.length / cols);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    canvas.width = cols;
    canvas.height = rows;
    const img = ctx.createImageData(cols, rows);
    values.forEach((v, i) => {
      const t = Math.max(-1, Math.min(1, v / absMax));
      // blue (neg) ← neutral → orange (pos)
      const [r, g, b] = t >= 0 ? mix([240, 240, 240], [234, 88, 12], t) : mix([240, 240, 240], [37, 99, 235], -t);
      img.data.set([r, g, b, 255], i * 4);
    });
    ctx.putImageData(img, 0, 0);
  }, [values, absMax, rows]);
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10.5px] text-subtle">
        <span>各维度取值（每行 {cols} 维）</span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-2 w-3 rounded-sm bg-[#2563eb]" /> 负 <i className="ml-1 inline-block h-2 w-3 rounded-sm bg-[#ea580c]" /> 正
        </span>
      </div>
      <canvas ref={ref} className="w-full rounded border border-border [image-rendering:pixelated]" style={{ aspectRatio: `${cols} / ${rows}` }} />
    </div>
  );
}

function Histogram({ values, min, max }: { values: number[]; min: number; max: number }) {
  const bins = 40;
  const counts = useMemo(() => {
    const c = new Array(bins).fill(0);
    const span = max - min || 1;
    for (const v of values) c[Math.min(bins - 1, Math.floor(((v - min) / span) * bins))]++;
    return c;
  }, [values, min, max]);
  const peak = Math.max(...counts) || 1;
  return (
    <div>
      <div className="mb-1 text-[10.5px] text-subtle">取值分布</div>
      <div className="flex h-12 items-end gap-px">
        {counts.map((c, i) => (
          <div key={i} className="flex-1 rounded-t-[1px] bg-accent/70" style={{ height: `${(c / peak) * 100}%` }} title={`${c}`} />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between font-mono text-[10px] text-subtle">
        <span>{min.toFixed(3)}</span>
        <span>{max.toFixed(3)}</span>
      </div>
    </div>
  );
}

function mix(a: number[], b: number[], t: number) {
  return a.map((x, i) => Math.round(x + (b[i] - x) * t));
}
