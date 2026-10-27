import type { CollectionRef, MigrationJob } from "@shared/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { keys, useCollections, useConnections, useDatabases } from "@/lib/queries";
import { fmtNum } from "@/lib/utils";
import { Button, Dialog, ErrorBox, Field, Input, Select } from "./ui";

/** Live job state over SSE. */
export function useMigrationEvents(id: string | null) {
  const [job, setJob] = useState<MigrationJob | null>(null);
  useEffect(() => {
    if (!id) return setJob(null);
    const es = api.migrations.events(id);
    es.onmessage = (e) => {
      const j = JSON.parse(e.data) as MigrationJob;
      setJob(j);
      if (j.state !== "running") es.close();
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [id]);
  return job;
}

export function MigrationProgress({ job }: { job: MigrationJob }) {
  const pct = job.total ? job.copied / job.total : job.state === "done" ? 1 : 0;
  const tone = job.state === "error" ? "bg-danger" : job.state === "cancelled" ? "bg-subtle" : job.state === "done" ? "bg-success" : "bg-accent";
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted">
          {{ running: "复制中…", done: "完成", error: "失败", cancelled: "已取消" }[job.state]}
          {job.method === "fork" ? "（fork）" : ""}
        </span>
        <span className="font-mono tabular-nums">
          {fmtNum(job.copied)} / {fmtNum(job.total)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
        <div className={`h-full rounded-full transition-[width] ${tone}`} style={{ width: `${pct * 100}%` }} />
      </div>
      {job.error ? <ErrorBox error={job.error} /> : null}
    </div>
  );
}

/** Target picker shared by the dialog and the migrations page. */
export function TargetPicker({ value, onChange }: { value: CollectionRef; onChange: (v: CollectionRef) => void }) {
  const { data: connections } = useConnections();
  const { data: dbs } = useDatabases(value.connectionId || undefined);
  return (
    <div className="grid grid-cols-3 gap-3">
      <Field label="连接">
        <Select value={value.connectionId} onChange={(e) => onChange({ ...value, connectionId: e.target.value, database: "" })}>
          {connections?.map((c) => (
            <option key={c.id} value={c.id} disabled={c.readOnly}>
              {c.name}
              {c.readOnly ? "（只读）" : ""}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="数据库">
        <Select value={value.database} onChange={(e) => onChange({ ...value, database: e.target.value })}>
          <option value="" disabled>
            选择…
          </option>
          {dbs?.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="集合名">
        <Input value={value.collection} onChange={(e) => onChange({ ...value, collection: e.target.value })} />
      </Field>
    </div>
  );
}

export function SourcePicker({ value, onChange }: { value: CollectionRef; onChange: (v: CollectionRef) => void }) {
  const { data: connections } = useConnections();
  const { data: dbs } = useDatabases(value.connectionId || undefined);
  const { data: cols } = useCollections(value.connectionId || undefined, value.database || undefined);
  return (
    <div className="grid grid-cols-3 gap-3">
      <Field label="连接">
        <Select value={value.connectionId} onChange={(e) => onChange({ connectionId: e.target.value, database: "", collection: "" })}>
          {connections?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="数据库">
        <Select value={value.database} onChange={(e) => onChange({ ...value, database: e.target.value, collection: "" })}>
          <option value="" disabled>
            选择…
          </option>
          {dbs?.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="集合">
        <Select value={value.collection} onChange={(e) => onChange({ ...value, collection: e.target.value })}>
          <option value="" disabled>
            选择…
          </option>
          {cols?.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}（{fmtNum(c.count)}）
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

export function CopyCollectionDialog({ open, onOpenChange, source }: { open: boolean; onOpenChange: (o: boolean) => void; source: CollectionRef }) {
  const [target, setTarget] = useState<CollectionRef>({ ...source, collection: `${source.collection}_copy` });
  const [mode, setMode] = useState<"create" | "append">("create");
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useMigrationEvents(jobId);
  const qc = useQueryClient();

  useEffect(() => {
    if (open) {
      setTarget({ ...source, collection: `${source.collection}_copy` });
      setJobId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (job?.state === "done") qc.invalidateQueries({ queryKey: keys.collections(job.input.target.connectionId, job.input.target.database) });
  }, [job?.state, job?.input, qc]);

  const start = useMutation({ mutationFn: () => api.migrations.start({ source, target, mode }), onSuccess: (j) => setJobId(j.id) });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="复制 / 迁移集合"
      description="分批读取原始向量、文档与 metadata 写入目标，不重新计算 embedding"
      width="max-w-2xl"
      footer={
        job?.state === "running" ? (
          <Button variant="outline" onClick={() => api.migrations.cancel(job.id)}>
            取消任务
          </Button>
        ) : job?.state === "done" ? (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Link
              to={`/c/${job.input.target.connectionId}/${encodeURIComponent(job.input.target.database)}/${encodeURIComponent(job.input.target.collection)}`}
              onClick={() => onOpenChange(false)}
            >
              <Button variant="primary">
                打开目标集合 <ArrowRight />
              </Button>
            </Link>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => start.mutate()} loading={start.isPending} disabled={!target.database || target.collection.trim().length < 3}>
              开始复制
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-sunken px-3 py-2 text-xs">
          <span className="text-muted">源：</span>
          <span className="font-mono">
            {source.database} / {source.collection}
          </span>
        </div>
        <TargetPicker value={target} onChange={setTarget} />
        <Field label="目标已存在时">
          <Select value={mode} onChange={(e) => setMode(e.target.value as "create" | "append")}>
            <option value="create">报错（只创建新集合；同库时优先尝试 fork）</option>
            <option value="append">合并写入（upsert，同 ID 覆盖）</option>
          </Select>
        </Field>
        {job ? (
          <>
            <MigrationProgress job={job} />
            {job.state === "done" ? (
              <div className="flex items-center gap-2 text-xs text-success">
                <CheckCircle2 className="size-3.5" /> 已复制 {fmtNum(job.copied)} 条，用时 {(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000).toFixed(1)}s
              </div>
            ) : null}
          </>
        ) : null}
        <ErrorBox error={start.error} />
      </div>
    </Dialog>
  );
}
