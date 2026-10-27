import { FileUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AUTO_ID, guessMapping, type Mapping, NONE, readFile, type Records, type Row, toRecords } from "@/lib/import";
import { useInvalidateCollection } from "@/lib/queries";
import { fmtNum } from "@/lib/utils";
import { Button, Dialog, ErrorBox, Field, Select } from "./ui";

const BATCH = 100;

export function ImportDialog({ cid, db, col, open, onOpenChange }: { cid: string; db: string; col: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [file, setFile] = useState<{ name: string; rows: Row[]; csv: boolean } | null>(null);
  const [mapping, setMapping] = useState<Mapping>({ id: AUTO_ID, document: NONE, embedding: NONE, metadata: [], infer: true });
  const [mode, setMode] = useState<"add" | "upsert">("upsert");
  const [error, setError] = useState<unknown>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const cancelled = useRef(false);
  const invalidate = useInvalidateCollection();
  const running = progress !== null && progress.done < progress.total && !error;

  useEffect(() => {
    if (open) {
      setFile(null);
      setError(null);
      setProgress(null);
    }
  }, [open]);

  const fields = useMemo(() => {
    const seen = new Set<string>();
    for (const r of file?.rows.slice(0, 200) ?? []) for (const k of Object.keys(r)) seen.add(k);
    return [...seen];
  }, [file]);

  const pick = async (f: File) => {
    setError(null);
    setProgress(null);
    try {
      const parsed = await readFile(f);
      if (!parsed.rows.length) throw new Error("文件里没有记录");
      setMapping(guessMapping(parsed.rows));
      setFile({ name: f.name, ...parsed });
    } catch (e) {
      setFile(null);
      setError(e);
    }
  };

  const setRole = (role: "id" | "document" | "embedding", value: string) =>
    setMapping((m) => ({ ...m, [role]: value, metadata: m.metadata.filter((k) => k !== value) }));
  const toggleMeta = (k: string) =>
    setMapping((m) => ({ ...m, metadata: m.metadata.includes(k) ? m.metadata.filter((x) => x !== k) : [...m.metadata, k] }));

  const preview = useMemo(() => {
    if (!file) return { records: null, error: null };
    try {
      return { records: toRecords(file.rows.slice(0, 3), mapping, file.csv), error: null };
    } catch (e) {
      return { records: null, error: e };
    }
  }, [file, mapping]);

  const run = async () => {
    if (!file) return;
    setError(null);
    cancelled.current = false;
    let records: Records;
    try {
      records = toRecords(file.rows, mapping, file.csv);
      const bad = records.findIndex((r) => !r.embedding && typeof r.document !== "string");
      if (bad >= 0) throw new Error(`第 ${bad + 1} 条既没有文档也没有向量，Chroma 无法写入`);
    } catch (e) {
      setError(e);
      return;
    }
    setProgress({ done: 0, total: records.length });
    let done = 0;
    try {
      for (let i = 0; i < records.length; i += BATCH) {
        if (cancelled.current) throw new Error(`已取消，已写入 ${fmtNum(done)} 条`);
        const chunk = records.slice(i, i + BATCH);
        await api.records.write(cid, db, col, { mode, records: chunk, embedMissing: true });
        done += chunk.length;
        setProgress({ done, total: records.length });
      }
      toast.success(`已导入 ${fmtNum(done)} 条记录`);
      onOpenChange(false);
    } catch (e) {
      setError(done ? new Error(`${(e as Error).message}\n（前 ${fmtNum(done)} 条已写入）`) : e);
    } finally {
      if (done) invalidate(cid, db, col);
    }
  };

  const fieldOptions = (extra: Array<[string, string]>) => (
    <>
      {extra.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
      {fields.map((f) => (
        <option key={f} value={f}>
          {f}
        </option>
      ))}
    </>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !running && onOpenChange(o)}
      title="导入记录"
      description="支持 JSONL、JSON 数组 / Chroma 列格式、CSV。没有向量的记录会用集合绑定的 Embedding 自动计算。"
      width="max-w-2xl"
      footer={
        running ? (
          <Button variant="outline" onClick={() => (cancelled.current = true)}>
            取消导入
          </Button>
        ) : (
          <>
            <Select value={mode} onChange={(e) => setMode(e.target.value as "add" | "upsert")} className="mr-auto w-44" disabled={!file}>
              <option value="upsert">upsert（存在则覆盖）</option>
              <option value="add">add（ID 已存在则报错）</option>
            </Select>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button variant="primary" onClick={run} disabled={!file || Boolean(preview.error)}>
              导入 {file ? `${fmtNum(file.rows.length)} 条` : ""}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border-strong px-4 py-3 hover:bg-hover">
          <FileUp className="size-5 text-subtle" />
          <span className="min-w-0 flex-1 text-xs">
            {file ? (
              <>
                <span className="font-medium">{file.name}</span>
                <span className="text-muted"> · {fmtNum(file.rows.length)} 条 · {fields.length} 个字段</span>
              </>
            ) : (
              <span className="text-muted">选择 .jsonl / .json / .csv 文件</span>
            )}
          </span>
          <input
            type="file"
            accept=".jsonl,.ndjson,.json,.csv"
            className="hidden"
            disabled={running}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pick(f);
              e.target.value = "";
            }}
          />
        </label>

        {file ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Field label="ID 字段">
                <Select value={mapping.id} onChange={(e) => setRole("id", e.target.value)}>
                  {fieldOptions([[AUTO_ID, "自动生成 UUID"]])}
                </Select>
              </Field>
              <Field label="文档字段">
                <Select value={mapping.document} onChange={(e) => setRole("document", e.target.value)}>
                  {fieldOptions([[NONE, "（无）"]])}
                </Select>
              </Field>
              <Field label="向量字段">
                <Select value={mapping.embedding} onChange={(e) => setRole("embedding", e.target.value)}>
                  {fieldOptions([[NONE, "（无，自动计算）"]])}
                </Select>
              </Field>
            </div>
            <Field label="写入 metadata 的字段" hint="名为 metadata 的对象字段会被展开成多个 key；嵌套对象会以 JSON 文本保存">
              <div className="flex flex-wrap gap-1.5">
                {fields
                  .filter((f) => ![mapping.id, mapping.document, mapping.embedding].includes(f))
                  .map((f) => (
                    <label key={f} className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-border px-2 py-1 font-mono text-[11px]">
                      <input type="checkbox" checked={mapping.metadata.includes(f)} onChange={() => toggleMeta(f)} className="accent-[var(--accent)]" />
                      {f}
                    </label>
                  ))}
              </div>
            </Field>
            {file.csv ? (
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={mapping.infer} onChange={(e) => setMapping({ ...mapping, infer: e.target.checked })} className="accent-[var(--accent)]" />
                把 metadata 里的数字和 true/false 识别为对应类型（否则一律按字符串）
              </label>
            ) : null}
            <Field label="预览（前 3 条）">
              {preview.records ? (
                <pre className="max-h-48 overflow-auto rounded-md bg-sunken p-2.5 font-mono text-[11px] leading-relaxed">
                  {JSON.stringify(
                    preview.records.map((r) => (r.embedding ? { ...r, embedding: `[${r.embedding.length} 维]` } : r)),
                    null,
                    2,
                  )}
                </pre>
              ) : (
                <ErrorBox error={preview.error} />
              )}
            </Field>
          </>
        ) : null}

        {progress ? (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted tabular-nums">
              <span>写入中…</span>
              <span>
                {fmtNum(progress.done)} / {fmtNum(progress.total)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          </div>
        ) : null}
        <ErrorBox error={error} />
      </div>
    </Dialog>
  );
}
