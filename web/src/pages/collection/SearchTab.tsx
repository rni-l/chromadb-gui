import type { CollectionDetail, SearchHit, SearchInput } from "@shared/types";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Code2, History, Search, Star, X } from "lucide-react";
import { useEffect, useState } from "react";
import { CodeDialog } from "@/components/CodeDialog";
import { emptyFilters, FilterBar, hasFilters, type Filters } from "@/components/FilterBar";
import { Badge, Button, Empty, ErrorBox, Input, Select, Textarea, Tip } from "@/components/ui";
import { api } from "@/lib/api";
import type { CodeOp } from "@/lib/codegen";
import { type HistoryEntry, type SearchDraft, type SearchMode as Mode, useSearchHistory } from "@/lib/history";
import { cn, fmtScalar, spaceLabel } from "@/lib/utils";
import type { CollectionCtx } from "../CollectionPage";

const MODE_LABEL: Record<Mode, string> = { text: "文本", record: "记录", vector: "向量" };

function buildInput(d: SearchDraft): SearchInput {
  const base: SearchInput = { nResults: d.n, where: d.filters.where, whereDocument: d.filters.whereDocument };
  if (d.mode === "text") return { ...base, text: d.text };
  if (d.mode === "record") return { ...base, recordId: d.recordId.trim() };
  let embedding: unknown;
  try {
    embedding = JSON.parse(d.vector);
  } catch {
    embedding = null;
  }
  if (!Array.isArray(embedding) || !embedding.length || embedding.some((x) => typeof x !== "number")) {
    throw new Error("向量必须是数字数组，例如 [0.1, -0.2, …]");
  }
  return { ...base, embedding: embedding as number[] };
}

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
  const [showHistory, setShowHistory] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const canEmbed = Boolean(detail.embedding.profileId);
  const history = useSearchHistory(cid, db, col);

  // Inputs are built inside the mutation so parse errors surface as mutation errors.
  const search = useMutation({
    mutationFn: async (draft: SearchDraft) => {
      const input = buildInput(draft);
      return { input, result: await api.search(cid, db, col, input) };
    },
    onSuccess: (_r, draft) => history.add(draft),
  });

  const run = (patch?: Partial<SearchDraft>) => search.mutate({ mode, text, recordId, vector, n, filters, ...patch });

  const replay = (e: HistoryEntry) => {
    setMode(e.mode);
    setText(e.text);
    setRecordId(e.recordId);
    setVector(e.vector);
    setN(e.n);
    setFilters(e.filters);
    if (hasFilters(e.filters)) setShowFilters(true);
    setShowHistory(false);
    run(e);
  };

  // "查找相似" from the record drawer lands here.
  useEffect(() => {
    if (similarTo) {
      setMode("record");
      setRecordId(similarTo);
      run({ mode: "record", recordId: similarTo });
      onConsumeSimilar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [similarTo]);

  const result = search.data?.result;
  const lastInput = search.data?.input;
  const codeOp: CodeOp | null =
    lastInput && result
      ? {
          kind: "query",
          text: lastInput.text,
          recordId: lastInput.recordId,
          embedding: lastInput.embedding,
          queryEmbedding: result.queryEmbedding,
          nResults: lastInput.nResults ?? 10,
          where: lastInput.where,
          whereDocument: lastInput.whereDocument,
        }
      : null;

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
          <Button variant="ghost" size="sm" onClick={() => setShowHistory(!showHistory)} disabled={!history.entries.length}>
            <History /> 历史{history.entries.length ? ` (${history.entries.length})` : ""}
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
        {showHistory && history.entries.length ? (
          <HistoryList entries={history.entries} onReplay={replay} onPin={history.togglePin} onRemove={history.remove} onClear={history.clear} />
        ) : null}
      </div>

      <ErrorBox error={search.error} />

      {result ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1 text-xs text-muted">
            <span>
              {result.hits.length} 条结果 · 度量 {spaceLabel[result.space]} · 向量 {result.queryEmbedding.length} 维
            </span>
            <span className="flex items-center gap-2 tabular-nums">
              {lastInput?.text ? `向量化 ${result.embedMs}ms · ` : ""}共 {result.tookMs}ms
              <Button variant="ghost" size="sm" onClick={() => setCodeOpen(true)}>
                <Code2 /> 复制为代码
              </Button>
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
      <CodeDialog cid={cid} detail={detail} op={codeOp} open={codeOpen} onOpenChange={setCodeOpen} />
    </div>
  );
}

function HistoryList({
  entries,
  onReplay,
  onPin,
  onRemove,
  onClear,
}: {
  entries: HistoryEntry[];
  onReplay: (e: HistoryEntry) => void;
  onPin: (at: number) => void;
  onRemove: (at: number) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-1 border-t border-border pt-3">
      <div className="flex items-center justify-between px-1 text-[11px] text-subtle">
        <span>点击重新执行 · 星标的查询会一直保留</span>
        <button onClick={onClear} className="hover:text-fg">
          清除未收藏
        </button>
      </div>
      <ul className="max-h-64 overflow-y-auto">
        {entries.map((e) => (
          <li key={e.at} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-hover">
            <button onClick={() => onPin(e.at)} aria-label={e.pinned ? "取消收藏" : "收藏"} className={cn("text-subtle hover:text-warn", e.pinned && "text-warn")}>
              <Star className={cn("size-3.5", e.pinned && "fill-current")} />
            </button>
            <button onClick={() => onReplay(e)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs">
              <Badge className="shrink-0">{MODE_LABEL[e.mode]}</Badge>
              <span className={cn("truncate", e.mode !== "text" && "font-mono text-[11px]")}>
                {e.mode === "text" ? e.text : e.mode === "record" ? e.recordId : `${e.vector.slice(0, 60)}…`}
              </span>
              <span className="shrink-0 text-[11px] text-subtle">
                top {e.n}
                {hasFilters(e.filters) ? " · 有过滤" : ""}
              </span>
            </button>
            <span className="shrink-0 text-[10.5px] text-subtle tabular-nums">{new Date(e.at).toLocaleString()}</span>
            <button onClick={() => onRemove(e.at)} aria-label="删除" className="text-subtle opacity-0 group-hover:opacity-100 hover:text-fg">
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
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
