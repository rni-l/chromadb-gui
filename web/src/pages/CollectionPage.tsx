import { Copy, Database, Layers, Lock, RefreshCw, ScatterChart, Search, Settings2, Table2 } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CopyCollectionDialog } from "@/components/CopyCollectionDialog";
import { RecordDrawer } from "@/components/RecordDrawer";
import { Badge, Button, Empty, ErrorBox, Spinner, Tabs, TabsContent, TabsList, TabsTrigger, Tip } from "@/components/ui";
import { PageHeader } from "@/layout/AppShell";
import { useCollection, useConnections, useInvalidateCollection } from "@/lib/queries";
import { fmtNum } from "@/lib/utils";
import { DataTab } from "./collection/DataTab";
import { SearchTab } from "./collection/SearchTab";
import { SettingsTab } from "./collection/SettingsTab";

// ECharts + UMAP are the bulk of the bundle; load them only when the tab opens.
const VisualizeTab = lazy(() => import("./collection/VisualizeTab").then((m) => ({ default: m.VisualizeTab })));

export interface CollectionCtx {
  cid: string;
  db: string;
  col: string;
  openRecord: (id: string) => void;
}

export function CollectionPage() {
  const { cid = "", db = "", col = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "data";
  const [recordId, setRecordId] = useState<string | null>(null);
  const [similarTo, setSimilarTo] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const { data: connections } = useConnections();
  const conn = connections?.find((c) => c.id === cid);
  const { data: detail, isLoading, error, isFetching } = useCollection(cid, db, col);
  const invalidate = useInvalidateCollection();

  const setTab = (t: string) => setParams(t === "data" ? {} : { tab: t }, { replace: true });
  const ctx: CollectionCtx = { cid, db, col, openRecord: setRecordId };

  if (isLoading) return <Spinner className="m-auto" />;
  if (error)
    return (
      <div className="p-6">
        <ErrorBox error={error} />
      </div>
    );
  if (!detail) return <Empty title="集合不存在" />;

  const ef = detail.embedding;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        crumbs={
          <>
            <span className="size-1.5 rounded-full" style={{ background: conn?.color || "var(--accent)" }} />
            <Link to={`/c/${cid}`} className="hover:text-fg">
              {conn?.name}
            </Link>
            <span>/</span>
            <Link to={`/c/${cid}/${encodeURIComponent(db)}`} className="inline-flex items-center gap-1 hover:text-fg">
              <Database className="size-3" /> {db}
            </Link>
          </>
        }
        title={
          <span className="inline-flex items-center gap-2">
            <Layers className="size-4 text-subtle" />
            {detail.name}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge>{fmtNum(detail.count)} 条</Badge>
            <Badge>{detail.dimension ? `${detail.dimension} 维` : "维度未知"}</Badge>
            <Badge>{detail.space}</Badge>
            {conn?.readOnly ? (
              <Badge tone="warn">
                <Lock className="size-3" /> 只读
              </Badge>
            ) : null}
            {ef.profileName ? (
              <Tip content={`Embedding：${ef.profileName}（${{ binding: "手动绑定", auto: "按集合配置自动匹配", ephemeral: "按集合配置临时创建", none: "" }[ef.source]}）`}>
                <span>
                  <Badge tone="accent">{ef.profileName}</Badge>
                </span>
              </Tip>
            ) : (
              <Tip content={ef.hint ?? ""}>
                <button onClick={() => setTab("settings")}>
                  <Badge tone="warn">未配置 Embedding · 文本检索不可用</Badge>
                </button>
              </Tip>
            )}
          </span>
        }
        actions={
          <>
            <Button variant="ghost" size="icon" onClick={() => invalidate(cid, db, col)} aria-label="刷新">
              <RefreshCw className={isFetching ? "animate-spin" : ""} />
            </Button>
            <Button variant="outline" onClick={() => setCopyOpen(true)}>
              <Copy /> 复制 / 迁移
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border bg-panel px-4">
          <TabsList>
            <TabsTrigger value="data">
              <Table2 /> 数据
            </TabsTrigger>
            <TabsTrigger value="search">
              <Search /> 检索
            </TabsTrigger>
            <TabsTrigger value="visualize">
              <ScatterChart /> 向量空间
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings2 /> 设置
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="data" className="flex min-h-0 flex-1 flex-col">
          <DataTab ctx={ctx} detail={detail} />
        </TabsContent>
        <TabsContent value="search" className="min-h-0 flex-1 overflow-y-auto">
          <SearchTab ctx={ctx} detail={detail} similarTo={similarTo} onConsumeSimilar={() => setSimilarTo(null)} />
        </TabsContent>
        <TabsContent value="visualize" className="flex min-h-0 flex-1 flex-col">
          <Suspense fallback={<Spinner className="m-auto" />}>
            <VisualizeTab ctx={ctx} detail={detail} />
          </Suspense>
        </TabsContent>
        <TabsContent value="settings" className="min-h-0 flex-1 overflow-y-auto">
          <SettingsTab ctx={ctx} detail={detail} onCopy={() => setCopyOpen(true)} />
        </TabsContent>
      </Tabs>

      <RecordDrawer
        cid={cid}
        db={db}
        col={col}
        recordId={recordId}
        onClose={() => setRecordId(null)}
        onFindSimilar={(id) => {
          setRecordId(null);
          setSimilarTo(id);
          setTab("search");
        }}
      />
      <CopyCollectionDialog open={copyOpen} onOpenChange={setCopyOpen} source={{ connectionId: cid, database: db, collection: col }} />
    </div>
  );
}
