import type { ConnectionPublic } from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Boxes, Plus, ScatterChart, Search, Server } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ConnectionDialog } from "@/components/ConnectionDialog";
import { Badge, Button, Empty, ErrorBox, Spinner } from "@/components/ui";
import { PageHeader } from "@/layout/AppShell";
import { Logo } from "@/layout/Sidebar";
import { api } from "@/lib/api";
import { keys, useConnections, useDatabases } from "@/lib/queries";

export function HomePage() {
  const { data: connections, isLoading } = useConnections();
  const [open, setOpen] = useState(false);

  if (isLoading) return <Spinner className="m-auto" />;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {connections?.length ? (
        <>
          <PageHeader
            title="连接"
            subtitle="选择一个 Chroma 连接开始浏览"
            actions={
              <Button variant="primary" onClick={() => setOpen(true)}>
                <Plus /> 新建连接
              </Button>
            }
          />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3 p-6">
            {connections.map((c) => (
              <ConnectionCard key={c.id} conn={c} />
            ))}
          </div>
        </>
      ) : (
        <Welcome onAdd={() => setOpen(true)} />
      )}
      <ConnectionDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function ConnectionCard({ conn }: { conn: ConnectionPublic }) {
  const { data: status, isLoading } = useQuery({ queryKey: keys.status(conn.id), queryFn: () => api.connections.status(conn.id) });
  return (
    <Link
      to={`/c/${conn.id}`}
      className="group flex flex-col gap-3 rounded-xl border border-border bg-panel p-4 transition-shadow hover:shadow-pop"
    >
      <div className="flex items-center gap-2">
        <span className="size-2.5 rounded-full" style={{ background: conn.color || "var(--accent)" }} />
        <span className="flex-1 truncate font-semibold">{conn.name}</span>
        {isLoading ? <Spinner className="size-3.5" /> : status?.ok ? <Badge tone="success">在线 · {status.latencyMs}ms</Badge> : <Badge tone="danger">不可用</Badge>}
      </div>
      <div className="truncate font-mono text-xs text-muted">{conn.url}</div>
      {status?.ok ? (
        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            tenant {status.tenant} · {status.databases?.length ?? 0} 个数据库
          </span>
          <ArrowRight className="size-3.5 text-subtle transition-transform group-hover:translate-x-0.5" />
        </div>
      ) : status?.error ? (
        <div className="line-clamp-2 text-xs text-danger">{status.error}</div>
      ) : null}
    </Link>
  );
}

function Welcome({ onAdd }: { onAdd: () => void }) {
  const features = [
    { icon: <Boxes />, title: "集合与文档", text: "浏览、过滤、编辑、批量写入，查看向量与 metadata" },
    { icon: <Search />, title: "语义检索", text: "自然语言或以记录找相似，显示距离与相似度" },
    { icon: <ScatterChart />, title: "向量空间", text: "PCA / UMAP 降维散点，按 metadata 着色" },
  ];
  return (
    <div className="m-auto flex w-full max-w-2xl flex-col items-center px-6 py-16 text-center">
      <Logo className="size-12" />
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">Chroma GUI</h1>
      <p className="mt-2 text-sm text-muted">本地运行的 ChromaDB 1.x 可视化管理工具。先添加一个连接。</p>
      <Button variant="primary" className="mt-6" onClick={onAdd}>
        <Server /> 添加连接
      </Button>
      <div className="mt-12 grid w-full gap-3 text-left sm:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border border-border bg-panel p-4">
            <div className="text-accent-text [&_svg]:size-5">{f.icon}</div>
            <div className="mt-2 text-[13px] font-semibold">{f.title}</div>
            <div className="mt-1 text-xs leading-relaxed text-muted">{f.text}</div>
          </div>
        ))}
      </div>
      <p className="mt-10 text-xs text-subtle">
        还没有 Chroma？<code className="rounded bg-sunken px-1.5 py-0.5 font-mono">docker run -p 8000:8000 chromadb/chroma</code>
      </p>
    </div>
  );
}

/** /c/:cid → the connection's preferred database. */
export function ConnectionRedirect() {
  const { cid = "" } = useParams();
  const { data: connections } = useConnections();
  const { data: dbs, error } = useDatabases(cid);
  const conn = connections?.find((c) => c.id === cid);
  if (connections && !conn) return <Empty title="连接不存在">它可能已被删除。</Empty>;
  if (error) return <ErrorBox error={error} className="m-6" />;
  if (!dbs || !conn) return <Spinner className="m-auto" />;
  if (!dbs.length) return <Empty title="此 tenant 下没有数据库" />;
  const target = dbs.find((d) => d.name === conn.database) ?? dbs.find((d) => d.name === "default_database") ?? dbs[0];
  return <Navigate replace to={`/c/${cid}/${encodeURIComponent(target.name)}`} />;
}
