import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Database, Layers, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { CreateCollectionDialog } from "@/components/CreateCollectionDialog";
import { confirm } from "@/components/confirm";
import { Badge, Button, Dialog, Empty, ErrorBox, Field, Input, Menu, MenuItem, MenuSeparator, Spinner } from "@/components/ui";
import { PageHeader } from "@/layout/AppShell";
import { api } from "@/lib/api";
import { keys, useCollections, useConnections, useDatabases } from "@/lib/queries";
import { fmtNum } from "@/lib/utils";

export function DatabasePage() {
  // react-router already decodes params
  const { cid = "", db = "" } = useParams();
  const { data: connections } = useConnections();
  const conn = connections?.find((c) => c.id === cid);
  const { data: dbs } = useDatabases(cid);
  const { data: cols, isLoading, error, refetch, isFetching } = useCollections(cid, db);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [newDb, setNewDb] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const filtered = useMemo(() => (cols ?? []).filter((c) => c.name.toLowerCase().includes(q.toLowerCase())), [cols, q]);
  const totalRecords = cols?.reduce((s, c) => s + (c.count ?? 0), 0) ?? 0;

  const dropDb = useMutation({
    mutationFn: () => api.databases.remove(cid, db),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.databases(cid) });
      toast.success(`数据库「${db}」已删除`);
      navigate(`/c/${cid}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        crumbs={
          <>
            <span className="size-1.5 rounded-full" style={{ background: conn?.color || "var(--accent)" }} />
            {conn?.name}
          </>
        }
        title={
          <Menu
            align="start"
            trigger={
              <button className="inline-flex items-center gap-1.5 rounded-md hover:text-accent-text">
                <Database className="size-4 text-subtle" />
                {db}
                <ChevronDown className="size-4 text-subtle" />
              </button>
            }
          >
            {dbs?.map((d) => (
              <MenuItem key={d.name} onSelect={() => navigate(`/c/${cid}/${encodeURIComponent(d.name)}`)}>
                <Database /> {d.name}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem onSelect={() => setNewDb(true)}>
              <Plus /> 新建数据库
            </MenuItem>
            <MenuItem
              danger
              onSelect={async () => {
                if (
                  await confirm({
                    title: `删除数据库「${db}」？`,
                    body: "数据库内的所有集合和数据都会被永久删除，无法恢复。",
                    danger: true,
                    confirmText: "永久删除",
                    typeToConfirm: db,
                  })
                )
                  dropDb.mutate();
              }}
            >
              <Trash2 /> 删除此数据库
            </MenuItem>
          </Menu>
        }
        subtitle={cols ? `${cols.length} 个集合 · ${fmtNum(totalRecords)} 条记录` : " "}
        actions={
          <>
            <Button variant="ghost" size="icon" onClick={() => refetch()} aria-label="刷新">
              <RefreshCw className={isFetching ? "animate-spin" : ""} />
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus /> 新建集合
            </Button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {cols && cols.length > 6 ? (
          <div className="relative mb-4 max-w-xs">
            <Search className="absolute top-2 left-2.5 size-4 text-subtle" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="筛选集合…" className="pl-8" />
          </div>
        ) : null}
        {isLoading ? <Spinner className="mx-auto mt-10" /> : null}
        <ErrorBox error={error} />
        {cols?.length === 0 ? (
          <Empty icon={<Layers />} title="还没有集合">
            <Button variant="primary" className="mt-3" onClick={() => setCreating(true)}>
              <Plus /> 新建集合
            </Button>
          </Empty>
        ) : null}

        {filtered.length ? (
          <div className="overflow-hidden rounded-xl border border-border bg-panel">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-border bg-sunken text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">名称</th>
                  <th className="px-4 py-2 text-right font-medium">记录数</th>
                  <th className="px-4 py-2 font-medium">维度</th>
                  <th className="px-4 py-2 font-medium">度量</th>
                  <th className="px-4 py-2 font-medium">Embedding 函数</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const ef = c.configuration.embedding_function;
                  const space = c.configuration.hnsw?.space ?? (c.configuration.spann?.space as string | undefined) ?? "l2";
                  return (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-hover">
                      <td className="px-4 py-2.5">
                        <Link to={`/c/${cid}/${encodeURIComponent(db)}/${encodeURIComponent(c.name)}`} className="flex items-center gap-2 font-medium hover:text-accent-text">
                          <Layers className="size-3.5 text-subtle" />
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">{fmtNum(c.count)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted">{c.dimension ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <Badge>{space}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted">
                        {ef?.name ? (
                          <>
                            {ef.name}
                            {ef.config?.model_name ? <span className="text-subtle"> · {String(ef.config.model_name)}</span> : null}
                          </>
                        ) : (
                          <span className="text-subtle">{ef?.type ?? "—"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <CreateCollectionDialog cid={cid} db={db} open={creating} onOpenChange={setCreating} />
      <NewDatabaseDialog cid={cid} open={newDb} onOpenChange={setNewDb} />
    </div>
  );
}

function NewDatabaseDialog({ cid, open, onOpenChange }: { cid: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = useState("");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () => api.databases.create(cid, name.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.databases(cid) });
      onOpenChange(false);
      navigate(`/c/${cid}/${encodeURIComponent(name.trim())}`);
      setName("");
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="新建数据库"
      width="max-w-sm"
      footer={
        <Button variant="primary" onClick={() => create.mutate()} loading={create.isPending} disabled={!name.trim()}>
          创建
        </Button>
      }
    >
      <div className="space-y-3">
        <Field label="名称">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate()} />
        </Field>
        <ErrorBox error={create.error} />
      </div>
    </Dialog>
  );
}
