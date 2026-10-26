import type { CollectionDetail, SearchHit, SearchInput } from "@shared/types";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { emptyFilters, FilterBar, type Filters } from "@/components/FilterBar";
import { Badge, Button, Empty, ErrorBox, Input, Select, Textarea, Tip } from "@/components/ui";
import { api } from "@/lib/api";
import { cn, fmtScalar, spaceLabel } from "@/lib/utils";
import type { CollectionCtx } from "../CollectionPage";

type Mode = "text" | "record" | "vector";

export function SearchTab({
  ctx,
  detail,
  similarTo,
  onConsumeSimilar,
}: {
  ctx: CollectionCtx;
  detail: CollectionDetail;
  similarTo: string | null;
  onConsumeSimilar: () => void;
}) {
  const { cid, db, col, openRecord } = ctx;
  const [mode, setMode] = useState<Mode>("text");
  const [text, setText] = useState("");
  const [recordId, setRecordId] = useState("");
  const [vector, setVector] = useState("");
  const [n, setN] = useState(10);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [showFilters, setShowFilters] = useState(false);
  const canEmbed = Boolean(detail.embedding.profileId);

  // Inputs are built inside the mutation so parse errors surface as mutation errors.
  const search = useMutation({
    mutationFn: (build: () => SearchInput) => api.search(cid, db, col, build()),
  });

  const run = (override?: Partial<SearchInput>) =>
    search.mutate(() => {
      const base: SearchInput = { nResults: n, where: filters.where, whereDocument: filters.whereDocument };
      if (override) return { ...base, ...override };
      if (mode === "text") return { ...base, text };
      if (mode === "record") return { ...base, recordId: recordId.trim() };
      let embedding: unknown;
      try {
        embedding = JSON.parse(vector);
      } catch {
        embedding = null;
      }
      if (!Array.isArray(embedding) || !embedding.length || embedding.some((x) => typeof x !== "number")) {
        throw new Error("向量必须是数字数组，例如 [0.1, -0.2, …]");
      }
      return { ...base, embedding: embedding as number[] };
    });

  // "查找相似" from the record drawer lands here.
  useEffect(() => {
    if (similarTo) {
      setMode("record");
      setRecordId(similarTo);
      run({ recordId: similarTo });
      onConsumeSimilar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [similarTo]);

  const result = search.data;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="space-y-3 rounded-xl border border-border bg-panel p-4">
        <div className="flex items-center gap-1">
          {(
            [
              ["text", "自然语言"],
              ["record", "按记录 ID 找相似"],
              ["vector", "向量"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn("h-7 rounded-md px-2.5 text-xs font-medium text-muted hover:text-fg", mode === m && "bg-sunken text-fg")}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "text" ? (
          <>
            {!canEmbed ? (
              <div className="flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {detail.embedding.hint}
              </div>
            ) : null}
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-subtle" />
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (text.trim()) run();
                  }
                }}
                rows={2}
                placeholder="输入一段文字，按 Enter 检索语义最接近的记录…"
                className="resize-none pl-9 text-sm"
                autoFocus
              />
            </div>
          </>
        ) : mode === "record" ? (
          <Input value={recordId} onChange={(e) => setRecordId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="记录 ID" className="font-mono text-xs" />
        ) : (
          <Textarea value={vector} onChange={(e) => setVector(e.target.value)} rows={3} placeholder="[0.012, -0.034, …]" className="font-mono text-xs" />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">返回</span>
          <Select value={n} onChange={(e) => setN(Number(e.target.value))} className="h-7 w-20 text-xs">
            {[5, 10, 20, 50, 100].map((v) => (
              <option key={v} value={v}>
                {v} 条
              </option>
            ))}
          </Select>
          <Button variant="ghost" size="sm" onClick={() => setShowFilters(!showFilters)}>
            过滤条件{filters.where || filters.whereDocument ? " · 已设置" : ""}
          </Button>
          <div className="flex-1" />
          <span className="text-[11px] text-subtle">
            {detail.embedding.profileName ? `Embedding：${detail.embedding.profileName}` : null}
          </span>
          <Button variant="primary" onClick={() => run()} loading={search.isPending} disabled={mode === "text" ? !text.trim() || !canEmbed : mode === "record" ? !recordId.trim() : !vector.trim()}>
            <Search /> 检索
          </Button>
        </div>
        {showFilters ? <FilterBar value={filters} onChange={setFilters} className="border-t border-border pt-3" /> : null}
      </div>

      <ErrorBox error={search.error} />

      {result ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1 text-xs text-muted">
            <span>
              {result.hits.length} 条结果 · 度量 {spaceLabel[result.space]} · 向量 {result.queryEmbedding.length} 维
            </span>
            <span className="tabular-nums">
              {mode === "text" ? `向量化 ${result.embedMs}ms · ` : ""}共 {result.tookMs}ms
            </span>
          </div>
          {result.hits.length ? (
            result.hits.map((h, i) => <Hit key={h.id} hit={h} rank={i + 1} space={result.space} onOpen={() => openRecord(h.id)} />)
          ) : (
            <Empty title="没有结果" />
          )}
        </div>
      ) : !search.isPending ? (
        <Empty icon={<Search />} title="语义检索">
          文本会先用集合绑定的 Embedding 配置向量化，再在集合中做近邻搜索。相似度按距离度量换算：cosine/ip 为 1 − d，l2 为 1/(1+d)。
        </Empty>
      ) : null}
    </div>
  );
}

function Hit({ hit, rank, space, onOpen }: { hit: SearchHit; rank: number; space: CollectionDetail["space"]; onOpen: () => void }) {
  const pct = Math.max(0, Math.min(1, hit.similarity));
  const meta = Object.entries(hit.metadata ?? {});
  return (
    <button onClick={onOpen} className="flex w-full gap-4 rounded-xl border border-border bg-panel p-4 text-left transition-shadow hover:shadow-pop">
      <div className="flex w-16 shrink-0 flex-col items-center gap-1.5 pt-0.5">
        <span className="text-[11px] text-subtle">#{rank}</span>
        <Tip content={`distance = ${hit.distance.toFixed(6)}（${space}）`}>
          <span className="font-mono text-base font-semibold tabular-nums">{hit.similarity.toFixed(3)}</span>
        </Tip>
        <div className="h-1 w-full overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-accent" style={{ width: `${pct * 100}%` }} />
        </div>
        <span className="font-mono text-[10px] text-subtle">d={hit.distance.toFixed(4)}</span>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="truncate font-mono text-[11px] text-muted">{hit.id}</div>
        <div className="line-clamp-4 text-[13px] leading-relaxed">{hit.document ?? <span className="text-subtle">（无文档）</span>}</div>
        {meta.length ? (
          <div className="flex flex-wrap gap-1">
            {meta.slice(0, 8).map(([k, v]) => (
              <Badge key={k} className="font-mono font-normal">
                {k}: {fmtScalar(v)}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
    </button>
  );
}
