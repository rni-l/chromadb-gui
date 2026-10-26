import type { CollectionDetail, RecordRow } from "@shared/types";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AddRecordsDialog } from "@/components/AddRecordsDialog";
import { confirm } from "@/components/confirm";
import { emptyFilters, FilterBar, hasFilters, type Filters } from "@/components/FilterBar";
import { Button, Empty, ErrorBox, Select, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { keys, useInvalidateCollection } from "@/lib/queries";
import { cn, fmtNum, fmtScalar, metadataKeys } from "@/lib/utils";
import type { CollectionCtx } from "../CollectionPage";

const PAGE_SIZES = [25, 50, 100, 200];
const MAX_META_COLS = 4;

export function DataTab({ ctx, detail }: { ctx: CollectionCtx; detail: CollectionDetail }) {
  const { cid, db, col, openRecord } = ctx;
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const invalidate = useInvalidateCollection();

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: [...keys.records(cid, db, col), { page, pageSize, filters }],
    queryFn: ({ signal }) =>
      api.records.get(cid, db, col, { offset: page * pageSize, limit: pageSize, where: filters.where, whereDocument: filters.whereDocument }, signal),
    placeholderData: keepPreviousData,
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? null;
  const metaCols = useMemo(() => metadataKeys(rows, MAX_META_COLS), [rows]);
  const hasExtraMeta = rows.some((r) => Object.keys(r.metadata ?? {}).some((k) => !metaCols.includes(k)));
  const lastPage = total !== null ? Math.max(0, Math.ceil(total / pageSize) - 1) : rows.length < pageSize ? page : Infinity;

  const applyFilters = (f: Filters) => {
    setFilters(f);
    setPage(0);
    setSelected(new Set());
  };

  const removeSelected = useMutation({
    mutationFn: () => api.records.remove(cid, db, col, { ids: [...selected] }),
    onSuccess: (r) => {
      toast.success(`已删除 ${r.deleted ?? selected.size} 条记录`);
      setSelected(new Set());
      invalidate(cid, db, col);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const removeMatching = useMutation({
    mutationFn: () => api.records.remove(cid, db, col, filters),
    onSuccess: (r) => {
      toast.success(`已删除 ${r.deleted ?? "所有"} 条匹配记录`);
      applyFilters(emptyFilters);
      invalidate(cid, db, col);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <div className="shrink-0 space-y-3 border-b border-border px-4 py-3">
        <FilterBar value={filters} onChange={applyFilters} metadataKeys={metaCols} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
            <Plus /> 添加记录
          </Button>
          {selected.size ? (
            <Button
              variant="outline"
              size="sm"
              className="text-danger"
              loading={removeSelected.isPending}
              onClick={async () => {
                if (await confirm({ title: `删除选中的 ${selected.size} 条记录？`, danger: true, confirmText: "删除" })) removeSelected.mutate();
              }}
            >
              <Trash2 /> 删除选中 ({selected.size})
            </Button>
          ) : null}
          {hasFilters(filters) && rows.length ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:text-danger"
              loading={removeMatching.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: "删除所有匹配当前过滤条件的记录？",
                    body: (
                      <pre className="max-h-40 overflow-auto rounded bg-sunken p-2 font-mono text-[11px]">{JSON.stringify(filters, null, 2)}</pre>
                    ),
                    danger: true,
                    confirmText: "全部删除",
                  })
                )
                  removeMatching.mutate();
              }}
            >
              <Trash2 /> 删除全部匹配
            </Button>
          ) : null}
          <div className="flex-1" />
          {isFetching && !isLoading ? <Spinner className="size-3.5" /> : null}
          <span className="text-xs text-muted tabular-nums">
            {rows.length ? `${fmtNum(page * pageSize + 1)}–${fmtNum(page * pageSize + rows.length)}` : "0"}
            {total !== null ? ` / ${fmtNum(total)}` : hasFilters(filters) ? "（已过滤）" : ""}
          </span>
          <Select value={pageSize} onChange={(e) => (setPageSize(Number(e.target.value)), setPage(0))} className="h-7 w-20 text-xs">
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}/页
              </option>
            ))}
          </Select>
          <Button size="icon-sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="上一页">
            <ChevronLeft />
          </Button>
          <Button size="icon-sm" variant="outline" disabled={page >= lastPage} onClick={() => setPage(page + 1)} aria-label="下一页">
            <ChevronRight />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? <Spinner className="mx-auto mt-10" /> : null}
        <ErrorBox error={error} className="m-4" />
        {data && !rows.length ? (
          <Empty title={hasFilters(filters) ? "没有匹配的记录" : detail.count ? "这一页没有数据" : "集合是空的"}>
            {!hasFilters(filters) && !detail.count ? (
              <Button variant="primary" className="mt-3" onClick={() => setAdding(true)}>
                <Plus /> 添加记录
              </Button>
            ) : null}
          </Empty>
        ) : null}
        {rows.length ? (
          <table className={cn("w-full border-separate border-spacing-0 text-left text-[12.5px]", isFetching && "opacity-70")}>
            <thead className="sticky top-0 z-10 bg-sunken text-[11.5px] text-muted">
              <tr>
                <th className="w-9 border-b border-border px-3 py-2">
                  <input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="全选" className="accent-[var(--accent)]" />
                </th>
                <th className="border-b border-border px-3 py-2 font-medium">ID</th>
                <th className="border-b border-border px-3 py-2 font-medium">Document</th>
                {metaCols.map((k) => (
                  <th key={k} className="max-w-40 truncate border-b border-border px-3 py-2 font-mono font-medium" title={k}>
                    {k}
                  </th>
                ))}
                {hasExtraMeta ? <th className="border-b border-border px-3 py-2 font-medium">其它 metadata</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.id} row={r} metaCols={metaCols} extraCol={hasExtraMeta} selected={selected.has(r.id)} onToggle={() => toggle(r.id)} onOpen={() => openRecord(r.id)} />
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      <AddRecordsDialog cid={cid} db={db} col={col} open={adding} onOpenChange={setAdding} />
    </>
  );
}

function Row({ row, metaCols, extraCol, selected, onToggle, onOpen }: { row: RecordRow; metaCols: string[]; extraCol: boolean; selected: boolean; onToggle: () => void; onOpen: () => void }) {
  const rest = Object.entries(row.metadata ?? {}).filter(([k]) => !metaCols.includes(k));
  const cell = "border-b border-border px-3 py-2 align-top";
  return (
    <tr onClick={onOpen} className={cn("cursor-pointer hover:bg-hover", selected && "bg-accent-soft hover:bg-accent-soft")}>
      <td className={cell} onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`选择 ${row.id}`} className="accent-[var(--accent)]" />
      </td>
      <td className={cn(cell, "max-w-48 truncate font-mono text-[11.5px] text-muted")} title={row.id}>
        {row.id}
      </td>
      <td className={cn(cell, "max-w-xl min-w-64")}>
        {row.document ? <span className="line-clamp-2 leading-relaxed">{row.document}</span> : <span className="text-subtle">—</span>}
      </td>
      {metaCols.map((k) => {
        const v = row.metadata?.[k];
        return (
          <td key={k} className={cn(cell, "max-w-40 truncate font-mono text-[11.5px]")} title={v === undefined ? "" : fmtScalar(v)}>
            {v === undefined ? <span className="text-subtle">—</span> : fmtScalar(v)}
          </td>
        );
      })}
      {extraCol ? (
        <td className={cn(cell, "max-w-64")}>
          <div className="flex flex-wrap gap-1">
            {rest.slice(0, 3).map(([k, v]) => (
              <span key={k} className="max-w-full truncate rounded bg-sunken px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
                {k}: {fmtScalar(v)}
              </span>
            ))}
            {rest.length > 3 ? <span className="text-[10.5px] text-subtle">+{rest.length - 3}</span> : null}
          </div>
        </td>
      ) : null}
    </tr>
  );
}
