import type { CollectionDetail, Metadata } from "@shared/types";
import { useMutation } from "@tanstack/react-query";
import { Copy, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/confirm";
import { JsonEditor } from "@/components/JsonEditor";
import { Badge, Button, ErrorBox, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useInvalidateCollection, useProfiles } from "@/lib/queries";
import { parseJsonObject, spaceLabel } from "@/lib/utils";
import type { CollectionCtx } from "../CollectionPage";

function Card({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-panel">
      <div className="border-b border-border px-5 py-3">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  );
}

export function SettingsTab({ ctx, detail, onCopy }: { ctx: CollectionCtx; detail: CollectionDetail; onCopy: () => void }) {
  const { cid, db, col } = ctx;
  const navigate = useNavigate();
  const invalidate = useInvalidateCollection();
  const { data: profiles } = useProfiles();

  const [name, setName] = useState(detail.name);
  const [meta, setMeta] = useState("");
  const [efSearch, setEfSearch] = useState("");
  const [profileId, setProfileId] = useState("");
  const hnsw = detail.configuration.hnsw ?? (detail.configuration.spann as Record<string, number> | null) ?? {};

  useEffect(() => {
    setName(detail.name);
    setMeta(detail.metadata ? JSON.stringify(detail.metadata, null, 2) : "");
    setEfSearch(String(hnsw.ef_search ?? ""));
    setProfileId(detail.embedding.source === "binding" ? (detail.embedding.profileId ?? "") : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  const update = useMutation({
    mutationFn: (input: Parameters<typeof api.collections.update>[3]) => api.collections.update(cid, db, col, input),
    onSuccess: (info) => {
      toast.success("已保存");
      invalidate(cid, db, col);
      if (info.name !== col) navigate(`/c/${cid}/${encodeURIComponent(db)}/${encodeURIComponent(info.name)}?tab=settings`, { replace: true });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.collections.remove(cid, db, col),
    onSuccess: () => {
      toast.success(`集合「${col}」已删除`);
      invalidate(cid, db);
      navigate(`/c/${cid}/${encodeURIComponent(db)}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const declared = detail.embedding.declared;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <Card title="基本信息">
        <Field label="集合名称">
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
            <Button onClick={() => update.mutate({ name: name.trim() })} disabled={!name.trim() || name === detail.name} loading={update.isPending && update.variables?.name !== undefined}>
              重命名
            </Button>
          </div>
        </Field>
        <Field label="Metadata">
          <JsonEditor value={meta} onChange={setMeta} minHeight="80px" placeholder="{ }" />
        </Field>
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={() => {
              try {
                update.mutate({ metadata: (parseJsonObject(meta, "Metadata") ?? {}) as Metadata });
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
            loading={update.isPending && update.variables?.metadata !== undefined}
          >
            保存 Metadata
          </Button>
        </div>
        <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 border-t border-border pt-4 text-xs">
          <dt className="text-muted">ID</dt>
          <dd className="font-mono">{detail.id}</dd>
          <dt className="text-muted">Tenant / DB</dt>
          <dd className="font-mono">
            {detail.tenant} / {detail.database}
          </dd>
        </dl>
      </Card>

      <Card title="Embedding" description="本工具用它把文本转成向量（写入文档、语义检索、散点高亮）。必须与写入时使用的模型一致。">
        <div className="text-xs">
          <span className="text-muted">集合声明：</span>
          {declared?.name ? (
            <span className="font-mono">
              {declared.name}
              {declared.config?.model_name ? ` / ${String(declared.config.model_name)}` : ""}
              {declared.config?.api_base ? ` @ ${String(declared.config.api_base)}` : ""}
            </span>
          ) : (
            <span className="text-subtle">{declared?.type ?? "无"}</span>
          )}
          <span className="mx-2 text-subtle">→</span>
          <span className="text-muted">当前使用：</span>
          {detail.embedding.profileName ? <Badge tone="accent">{detail.embedding.profileName}</Badge> : <Badge tone="warn">无</Badge>}
        </div>
        {detail.embedding.hint ? <div className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">{detail.embedding.hint}</div> : null}
        <Field
          label="手动绑定 Embedding 配置"
          hint={
            <>
              绑定只保存在本机，不修改集合本身。没有合适的？去 <Link to="/settings" className="text-accent-text underline">设置</Link> 添加 OpenAI / Ollama / 兼容接口。
            </>
          }
        >
          <div className="flex gap-2">
            <Select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="">自动（按集合声明匹配）</option>
              {profiles?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Button onClick={() => update.mutate({ profileId: profileId || null })} loading={update.isPending && update.variables?.profileId !== undefined}>
              应用
            </Button>
          </div>
        </Field>
      </Card>

      <Card title="索引配置">
        <dl className="grid grid-cols-[140px_1fr] gap-y-1.5 text-xs">
          <dt className="text-muted">距离度量</dt>
          <dd>{spaceLabel[detail.space]}</dd>
          {(["ef_construction", "max_neighbors", "resize_factor", "sync_threshold"] as const).map((k) =>
            hnsw[k] !== undefined && hnsw[k] !== null ? (
              <FragmentRow key={k} k={k} v={String(hnsw[k])} />
            ) : null,
          )}
        </dl>
        <Field label="ef_search" hint="查询时探索的候选数，越大召回越高、越慢。可随时修改。">
          <div className="flex gap-2">
            <Input type="number" min={1} value={efSearch} onChange={(e) => setEfSearch(e.target.value)} className="w-40" />
            <Button
              onClick={() => update.mutate({ efSearch: Number(efSearch) })}
              disabled={!Number(efSearch) || Number(efSearch) === hnsw.ef_search}
              loading={update.isPending && update.variables?.efSearch !== undefined}
            >
              更新
            </Button>
          </div>
        </Field>
        <details className="text-xs">
          <summary className="cursor-pointer text-muted hover:text-fg">原始 configuration JSON</summary>
          <JsonEditor value={JSON.stringify(detail.configuration, null, 2)} readOnly className="mt-2" />
        </details>
      </Card>

      <ErrorBox error={update.error} />

      <Card title="复制与删除">
        <div className="flex items-center justify-between gap-4">
          <div className="text-xs text-muted">复制到新集合、其它数据库或其它连接，保留原有向量，不重新计算。</div>
          <Button variant="outline" onClick={onCopy}>
            <Copy /> 复制 / 迁移
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <div className="text-xs text-muted">永久删除集合及其全部 {detail.count.toLocaleString()} 条记录。</div>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={async () => {
              if (
                await confirm({
                  title: `删除集合「${col}」？`,
                  body: "集合中的所有记录与向量将被永久删除，无法恢复。",
                  danger: true,
                  confirmText: "永久删除",
                  typeToConfirm: col,
                })
              )
                remove.mutate();
            }}
          >
            <Trash2 /> 删除集合
          </Button>
        </div>
      </Card>
    </div>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="font-mono text-muted">{k}</dt>
      <dd className="font-mono">{v}</dd>
    </>
  );
}
