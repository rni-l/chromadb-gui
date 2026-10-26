import type { CollectionRef, MigrationJob } from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowRightLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MigrationProgress, SourcePicker, TargetPicker } from "@/components/CopyCollectionDialog";
import { Button, Empty, ErrorBox, Field, Select } from "@/components/ui";
import { PageHeader } from "@/layout/AppShell";
import { api } from "@/lib/api";
import { keys, useConnections } from "@/lib/queries";

export function MigrationsPage() {
  const { data: connections } = useConnections();
  const first = connections?.[0]?.id ?? "";
  const [source, setSource] = useState<CollectionRef>({ connectionId: "", database: "", collection: "" });
  const [target, setTarget] = useState<CollectionRef>({ connectionId: "", database: "", collection: "" });
  const [mode, setMode] = useState<"create" | "append">("create");
  const qc = useQueryClient();

  useEffect(() => {
    if (first && !source.connectionId) {
      setSource((s) => ({ ...s, connectionId: first }));
      setTarget((t) => ({ ...t, connectionId: first }));
    }
  }, [first, source.connectionId]);

  // Suggest a target name once a source collection is picked.
  useEffect(() => {
    if (source.collection) setTarget((t) => ({ ...t, collection: t.collection || `${source.collection}_copy` }));
  }, [source.collection]);

  const { data: jobs } = useQuery({
    queryKey: keys.migrations,
    queryFn: api.migrations.list,
    refetchInterval: (q) => (q.state.data?.some((j) => j.state === "running") ? 800 : false),
  });

  const start = useMutation({
    mutationFn: () => api.migrations.start({ source, target, mode }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.migrations }),
  });

  const nameOf = (id: string) => connections?.find((c) => c.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="迁移 / 复制" subtitle="在集合、数据库与连接之间复制数据（含原始向量），例如本地 → Chroma Cloud" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 p-6">
          {!connections?.length ? (
            <Empty icon={<ArrowRightLeft />} title="还没有连接">先在左侧添加连接。</Empty>
          ) : (
            <section className="space-y-4 rounded-xl border border-border bg-panel p-5">
              <div>
                <div className="mb-2 text-xs font-semibold text-muted">源集合</div>
                <SourcePicker value={source} onChange={setSource} />
              </div>
              <div className="flex justify-center text-subtle">
                <ArrowDown className="size-4" />
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold text-muted">目标</div>
                <TargetPicker value={target} onChange={setTarget} />
              </div>
              <div className="flex items-end gap-3">
                <Field label="目标已存在时" className="flex-1">
                  <Select value={mode} onChange={(e) => setMode(e.target.value as "create" | "append")}>
                    <option value="create">报错（只创建新集合）</option>
                    <option value="append">合并写入（upsert）</option>
                  </Select>
                </Field>
                <Button
                  variant="primary"
                  onClick={() => start.mutate()}
                  loading={start.isPending}
                  disabled={!source.collection || !target.database || target.collection.trim().length < 3}
                >
                  开始
                </Button>
              </div>
              <ErrorBox error={start.error} />
            </section>
          )}

          {jobs?.length ? (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">本次运行的任务</h3>
              {jobs.map((j) => (
                <JobRow key={j.id} job={j} nameOf={nameOf} />
              ))}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function JobRow({ job, nameOf }: { job: MigrationJob; nameOf: (id: string) => string }) {
  const { source: s, target: t } = job.input;
  return (
    <div className="space-y-3 rounded-xl border border-border bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono">
          {nameOf(s.connectionId)} / {s.database} / <b>{s.collection}</b>
        </span>
        <ArrowRightLeft className="size-3.5 text-subtle" />
        {job.state === "done" ? (
          <Link to={`/c/${t.connectionId}/${encodeURIComponent(t.database)}/${encodeURIComponent(t.collection)}`} className="font-mono text-accent-text hover:underline">
            {nameOf(t.connectionId)} / {t.database} / <b>{t.collection}</b>
          </Link>
        ) : (
          <span className="font-mono">
            {nameOf(t.connectionId)} / {t.database} / <b>{t.collection}</b>
          </span>
        )}
        <span className="ml-auto text-subtle">{new Date(job.startedAt).toLocaleTimeString()}</span>
        {job.state === "running" ? (
          <Button size="sm" variant="outline" onClick={() => api.migrations.cancel(job.id)}>
            取消
          </Button>
        ) : null}
      </div>
      <MigrationProgress job={job} />
    </div>
  );
}
