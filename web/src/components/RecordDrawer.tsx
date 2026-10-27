import type { Metadata } from "@shared/types";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { keys, useInvalidateCollection, useReadOnly } from "@/lib/queries";
import { cn, copyText, parseJsonObject } from "@/lib/utils";
import { confirm } from "./confirm";
import { EmbeddingInspector } from "./EmbeddingInspector";
import { JsonEditor } from "./JsonEditor";
import { Button, ErrorBox, SectionTitle, Sheet, Spinner, Textarea } from "./ui";

export function RecordDrawer({
  cid,
  db,
  col,
  recordId,
  onClose,
  onFindSimilar,
}: {
  cid: string;
  db: string;
  col: string;
  recordId: string | null;
  onClose: () => void;
  onFindSimilar?: (id: string) => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: [...keys.records(cid, db, col), "one", recordId],
    queryFn: () => api.records.get(cid, db, col, { ids: [recordId!], includeEmbeddings: true }),
    enabled: Boolean(recordId),
  });
  const record = data?.rows[0];
  const [doc, setDoc] = useState("");
  const [meta, setMeta] = useState("");
  const invalidate = useInvalidateCollection();

  useEffect(() => {
    if (record) {
      setDoc(record.document ?? "");
      setMeta(record.metadata ? JSON.stringify(record.metadata, null, 2) : "");
    }
  }, [record]);

  const docChanged = record && doc !== (record.document ?? "");
  const metaChanged = record && meta.trim() !== (record.metadata ? JSON.stringify(record.metadata, null, 2) : "");

  const save = useMutation({
    mutationFn: async () => {
      const next = parseJsonObject(meta, "Metadata") as Metadata | null;
      // Chroma merges metadata on update: removed keys must be sent as null to delete them.
      let metadata: Metadata | undefined;
      if (metaChanged) {
        metadata = { ...(next ?? {}) };
        for (const k of Object.keys(record?.metadata ?? {})) if (!(k in metadata)) metadata[k] = null;
      }
      return api.records.write(cid, db, col, {
        mode: "update",
        embedMissing: true,
        records: [{ id: recordId!, ...(docChanged ? { document: doc } : {}), ...(metadata ? { metadata } : {}) }],
      });
    },
    onSuccess: () => {
      toast.success(docChanged ? "已保存，并重新计算了向量" : "已保存");
      invalidate(cid, db, col);
    },
  });

  const readOnly = useReadOnly(cid);
  const remove = useMutation({
    mutationFn: () => api.records.remove(cid, db, col, { ids: [recordId!] }),
    onSuccess: () => {
      toast.success("记录已删除");
      invalidate(cid, db, col);
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Sheet
      open={Boolean(recordId)}
      onOpenChange={(o) => !o && onClose()}
      title={
        <span className="flex items-center gap-2">
          <span className="text-muted">记录</span>
          <code className="truncate font-mono">{recordId}</code>
          <Button variant="ghost" size="icon-sm" onClick={() => copyText(recordId!).then(() => toast.success("ID 已复制"))} aria-label="复制 ID">
            <Copy />
          </Button>
        </span>
      }
      footer={
        record ? (
          <>
            <Button
              variant="ghost"
              className={cn("mr-auto text-danger hover:text-danger", readOnly && "hidden")}
              onClick={async () => {
                if (await confirm({ title: "删除这条记录？", body: <code className="font-mono">{recordId}</code>, danger: true, confirmText: "删除" })) remove.mutate();
              }}
            >
              <Trash2 /> 删除
            </Button>
            {onFindSimilar ? (
              <Button variant="outline" onClick={() => onFindSimilar(recordId!)}>
                <Search /> 查找相似
              </Button>
            ) : null}
            {!readOnly ? (
              <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!docChanged && !metaChanged}>
                保存修改
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {isLoading ? <Spinner className="mx-auto mt-10" /> : null}
      <ErrorBox error={error} />
      {data && !record ? <ErrorBox error="记录不存在（可能已被删除）" /> : null}
      {record ? (
        <div className="space-y-6">
          <section>
            <SectionTitle>Document</SectionTitle>
            <Textarea value={doc} onChange={(e) => setDoc(e.target.value)} rows={Math.min(14, Math.max(4, Math.ceil(doc.length / 70)))} placeholder="（无文档）" />
            {docChanged ? <div className="mt-1 text-[11px] text-warn">保存时将用集合的 Embedding 配置重新计算向量</div> : null}
          </section>
          <section>
            <SectionTitle>Metadata</SectionTitle>
            <JsonEditor value={meta} onChange={setMeta} placeholder="{ }" minHeight="80px" />
          </section>
          {record.uri ? (
            <section>
              <SectionTitle>URI</SectionTitle>
              <code className="font-mono text-xs break-all">{record.uri}</code>
            </section>
          ) : null}
          <section>
            <SectionTitle>Embedding</SectionTitle>
            {record.embedding?.length ? <EmbeddingInspector embedding={record.embedding} /> : <div className="text-xs text-subtle">无向量</div>}
          </section>
          <ErrorBox error={save.error} />
        </div>
      ) : null}
    </Sheet>
  );
}
