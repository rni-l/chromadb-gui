// File → records for the import dialog: parse JSONL / JSON / CSV into rows, then map
// columns onto Chroma's id / document / embedding / metadata.

import type { Metadata, WriteRecordsInput } from "@shared/types";
import { parseCsv } from "./csv";

export type Row = Record<string, unknown>;
export type Records = WriteRecordsInput["records"];

export const AUTO_ID = "\0auto";
export const NONE = "";
const GUESS = {
  id: ["id", "_id", "ids", "uuid"],
  document: ["document", "documents", "text", "content", "page_content", "chunk"],
  embedding: ["embedding", "embeddings", "vector", "values"],
};

export async function readFile(file: File) {
  return parseRows(file.name, await file.text());
}

export function parseRows(name: string, text: string): { rows: Row[]; csv: boolean } {
  if (/\.csv$/i.test(name)) return { rows: parseCsv(text), csv: true };
  const trimmed = text.trim();
  if (/\.json$/i.test(name) || trimmed.startsWith("[") || (trimmed.startsWith("{") && !trimmed.includes("\n"))) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`JSON 解析失败：${(e as Error).message}`);
    }
    // Chroma's column format: { ids, documents, metadatas, embeddings }
    if (data && !Array.isArray(data) && typeof data === "object" && Array.isArray((data as { ids?: unknown }).ids)) {
      const c = data as { ids: string[]; documents?: unknown[]; metadatas?: unknown[]; embeddings?: unknown[] };
      data = c.ids.map((id, i) => ({ id, document: c.documents?.[i], metadata: c.metadatas?.[i], embedding: c.embeddings?.[i] }));
    }
    if (!Array.isArray(data)) throw new Error("JSON 文件需要是记录数组，或 { ids, documents, metadatas } 列格式");
    return { rows: data.filter((r) => r && typeof r === "object") as Row[], csv: false };
  }
  const rows = trimmed.split(/\r?\n/).flatMap((line, i) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as Row];
    } catch {
      throw new Error(`第 ${i + 1} 行不是合法 JSON`);
    }
  });
  return { rows, csv: false };
}

/** CSV cells are strings; turn "42" / "true" / "[1,2]" back into values when asked to. */
function coerce(v: unknown, csv: boolean, infer: boolean): unknown {
  if (!csv || !infer || typeof v !== "string") return v;
  const t = v.trim();
  if (t === "true" || t === "false") return t === "true";
  if (t !== "" && !Number.isNaN(Number(t))) return Number(t);
  return v;
}

function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (!t) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return v;
  }
}

function metaValue(v: unknown): Metadata[string] | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v) && v.every((x) => ["string", "number", "boolean"].includes(typeof x))) return v as Array<string | number | boolean>;
  // Chroma metadata is flat; nested values are kept as JSON text.
  return JSON.stringify(v);
}

export interface Mapping {
  id: string;
  document: string;
  embedding: string;
  metadata: string[];
  infer: boolean;
}

/** Pick id / document / embedding columns by common names; everything else becomes metadata. */
export function guessMapping(rows: Row[]): Mapping {
  const keys = new Set(rows.slice(0, 200).flatMap((r) => Object.keys(r)));
  const guess = (names: string[]) => names.find((n) => keys.has(n)) ?? NONE;
  const id = guess(GUESS.id) || AUTO_ID;
  const document = guess(GUESS.document);
  const embedding = guess(GUESS.embedding);
  return { id, document, embedding, metadata: [...keys].filter((k) => ![id, document, embedding].includes(k) && k !== "uri"), infer: true };
}

export function toRecords(rows: Row[], m: Mapping, csv: boolean): Records {
  return rows.map((row, i) => {
    const rec: Records[number] = { id: m.id === AUTO_ID ? crypto.randomUUID() : String(row[m.id] ?? "").trim() };
    if (!rec.id) throw new Error(`第 ${i + 1} 条缺少 ID（字段「${m.id}」为空）`);
    if (m.document) {
      const d = row[m.document];
      rec.document = d === undefined || d === null || d === "" ? null : typeof d === "string" ? d : JSON.stringify(d);
    }
    if (m.embedding) {
      const e = parseMaybeJson(row[m.embedding]);
      if (e !== undefined && e !== null) {
        if (!Array.isArray(e) || e.some((x) => typeof x !== "number")) throw new Error(`第 ${i + 1} 条的向量字段「${m.embedding}」不是数字数组`);
        rec.embedding = e as number[];
      }
    }
    const meta: Metadata = {};
    for (const key of m.metadata) {
      const raw = row[key];
      // A whole-object `metadata` column (our own export format) is spread into fields.
      const nested = key === "metadata" ? parseMaybeJson(raw) : undefined;
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        for (const [k, v] of Object.entries(nested)) {
          const mv = metaValue(v);
          if (mv !== undefined) meta[k] = mv;
        }
        continue;
      }
      const mv = metaValue(coerce(raw, csv, m.infer));
      if (mv !== undefined) meta[key] = mv;
    }
    if (Object.keys(meta).length) rec.metadata = meta;
    return rec;
  });
}
