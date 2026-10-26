import type { Metadata, WriteRecordsInput } from "@shared/types";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useInvalidateCollection } from "@/lib/queries";
import { cn, parseJsonObject } from "@/lib/utils";
import { JsonEditor } from "./JsonEditor";
import { Button, Dialog, ErrorBox, Field, Input, Select, Textarea } from "./ui";

const SAMPLE = `[
  { "id": "doc-1", "document": "Chroma is an open-source vector database.", "metadata": { "source": "docs" } },
  { "id": "doc-2", "document": "Embeddings map text to points in space.", "metadata": { "source": "blog", "page": 2 } }
]`;

type Records = WriteRecordsInput["records"];

function parseBulk(text: string): Records {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON 解析失败：${(e as Error).message}`);
  }
  // Accept Chroma's column format too: { ids, documents, metadatas, embeddings }
  if (data && !Array.isArray(data) && typeof data === "object" && Array.isArray((data as { ids?: unknown }).ids)) {
    const c = data as { ids: string[]; documents?: (string | null)[]; metadatas?: (Metadata | null)[]; embeddings?: number[][] };
    data = c.ids.map((id, i) => ({ id, document: c.documents?.[i], metadata: c.metadatas?.[i], embedding: c.embeddings?.[i] }));
  }
  if (!Array.isArray(data)) throw new Error("需要一个记录数组，或 { ids, documents, metadatas } 列格式对象");
  return data.map((r, i) => {
    if (!r || typeof r !== "object") throw new Error(`第 ${i + 1} 条不是对象`);
    const rec = r as Records[number];
    if (!rec.id || typeof rec.id !== "string") throw new Error(`第 ${i + 1} 条缺少字符串 id`);
    return rec;
  });
}

export function AddRecordsDialog({ cid, db, col, open, onOpenChange }: { cid: string; db: string; col: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [tab, setTab] = useState<"single" | "bulk">("single");
  const [id, setId] = useState("");
  const [doc, setDoc] = useState("");
  const [meta, setMeta] = useState("");
  const [bulk, setBulk] = useState("");
  const [mode, setMode] = useState<"add" | "upsert">("add");
  const invalidate = useInvalidateCollection();

  useEffect(() => {
    if (open) {
      setId(crypto.randomUUID());
      setDoc("");
      setMeta("");
    }
  }, [open]);

  const write = useMutation({
    mutationFn: () => {
      const records: Records =
        tab === "single" ? [{ id: id.trim(), document: doc, metadata: parseJsonObject(meta, "Metadata") as Metadata | null }] : parseBulk(bulk);
      if (tab === "single" && !doc.trim()) throw new Error("请输入文档内容");
      return api.records.write(cid, db, col, { mode, records, embedMissing: true });
    },
    onSuccess: (r) => {
      toast.success(`已写入 ${r.written} 条记录`);
      invalidate(cid, db, col);
      onOpenChange(false);
      setBulk("");
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="添加记录"
      description="没有提供 embedding 的记录会用集合绑定的 Embedding 配置自动计算"
      width="max-w-2xl"
      footer={
        <>
          <Select value={mode} onChange={(e) => setMode(e.target.value as "add" | "upsert")} className="mr-auto w-44">
            <option value="add">add（ID 已存在则报错）</option>
            <option value="upsert">upsert（存在则覆盖）</option>
          </Select>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" onClick={() => write.mutate()} loading={write.isPending}>
            写入
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="inline-grid grid-cols-2 gap-1 rounded-lg bg-sunken p-1">
          {(["single", "bulk"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn("h-7 rounded-md px-4 text-xs font-medium text-muted", tab === t && "bg-panel text-fg shadow-sm")}>
              {t === "single" ? "单条" : "批量 JSON"}
            </button>
          ))}
        </div>

        {tab === "single" ? (
          <>
            <Field label="ID">
              <Input value={id} onChange={(e) => setId(e.target.value)} className="font-mono text-xs" />
            </Field>
            <Field label="Document">
              <Textarea value={doc} onChange={(e) => setDoc(e.target.value)} rows={5} autoFocus placeholder="要写入并向量化的文本…" />
            </Field>
            <Field label="Metadata（可选）">
              <JsonEditor value={meta} onChange={setMeta} minHeight="64px" placeholder='{ "source": "manual" }' />
            </Field>
          </>
        ) : (
          <Field label="记录数组" hint="每条：{ id, document?, metadata?, embedding? }；也支持 Chroma 的列格式 { ids, documents, metadatas, embeddings }">
            <JsonEditor value={bulk} onChange={setBulk} minHeight="240px" maxHeight="420px" placeholder={SAMPLE} />
          </Field>
        )}
        <ErrorBox error={write.error} />
      </div>
    </Dialog>
  );
}
