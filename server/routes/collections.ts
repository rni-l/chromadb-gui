import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { stream } from "hono/streaming";
import { z } from "zod";
import type {
  CollectionConfigurationJson,
  CollectionDetail,
  CollectionInfo,
  GetRecordsResult,
  Metadata,
  ProjectionResult,
  RecordRow,
  SearchResult,
} from "../../shared/types.ts";
import type { Deps } from "../app.ts";
import type { RawGetResult, RecordBatch } from "../chroma-rest.ts";
import { assertWritable, isCloud, mapLimit, similarity, spaceOf } from "../context.ts";
import { createEmbedder, resolveEmbedding, toChromaEf } from "../embeddings.ts";
import { pca } from "../pca.ts";

const filter = z.record(z.string(), z.unknown()).nullish();
const metadata = z.record(z.string(), z.unknown()).nullish();
const WRITE_BATCH = 500;
const EXPORT_BATCH = 500;
/** POST endpoints that only read; every other non-GET request is a write. */
const READ_ONLY_POSTS = /\/(records\/get|search|projection)$/;

export function collectionRoutes({ store, pool }: Deps) {
  const r = new Hono();

  async function scope(c: Context) {
    const connectionId = c.req.param("cid")!;
    // PATCH checks for itself: rebinding an embedding profile only touches local config.
    if (!["GET", "PATCH"].includes(c.req.method) && !READ_ONLY_POSTS.test(c.req.path)) assertWritable(store, connectionId);
    const database = c.req.param("db")!;
    const connected = await pool.get(connectionId);
    return { ...connected, connectionId, database };
  }

  async function load(c: Context) {
    const s = await scope(c);
    const info = await s.rest.getCollection(s.tenant, s.database, c.req.param("name")!);
    return { ...s, info };
  }

  function embedderFor(s: Awaited<ReturnType<typeof load>>) {
    const res = resolveEmbedding(store, s.connectionId, s.info.id, s.info.configuration.embedding_function);
    if (!res.profile) throw new HTTPException(400, { message: res.hint });
    return createEmbedder(res.profile, store.getSettings());
  }

  // ---- collection CRUD ---------------------------------------------------

  r.get("/", async (c) => {
    const s = await scope(c);
    const list = await s.rest.listCollections(s.tenant, s.database);
    if (c.req.query("counts") !== "1") return c.json(list);
    const counts = await mapLimit(list, 8, (col) => s.rest.count(s.tenant, s.database, col.id).catch(() => null));
    return c.json(list.map((col, i) => ({ ...col, count: counts[i] })));
  });

  r.post("/", async (c) => {
    const input = z
      .object({
        name: z.string().trim().min(3, "集合名至少 3 个字符").max(512),
        metadata,
        space: z.enum(["l2", "cosine", "ip"]).optional(),
        efConstruction: z.number().int().positive().optional(),
        efSearch: z.number().int().positive().optional(),
        maxNeighbors: z.number().int().positive().optional(),
        profileId: z.string().optional(),
      })
      .parse(await c.req.json());
    const s = await scope(c);
    const index = {
      space: input.space,
      ef_construction: input.efConstruction,
      ef_search: input.efSearch,
      max_neighbors: input.maxNeighbors,
    };
    const configuration: CollectionConfigurationJson = isCloud(s.conn) ? { spann: index } : { hnsw: index };
    const profile = input.profileId ? store.getProfile(input.profileId) : undefined;
    if (input.profileId && !profile) throw new HTTPException(400, { message: "Embedding 配置不存在" });
    if (profile) configuration.embedding_function = toChromaEf(profile);
    const created = await s.rest.createCollection(s.tenant, s.database, {
      name: input.name,
      metadata: input.metadata as CollectionInfo["metadata"],
      configuration,
    });
    if (profile && profile.type !== "default") store.setBinding(s.connectionId, created.id, profile.id);
    return c.json(created, 201);
  });

  r.get("/:name", async (c) => {
    const s = await load(c);
    const count = await s.rest.count(s.tenant, s.database, s.info.id);
    const { profile: _p, ...embedding } = resolveEmbedding(store, s.connectionId, s.info.id, s.info.configuration.embedding_function);
    const detail: CollectionDetail = { ...s.info, count, space: spaceOf(s.info), embedding };
    return c.json(detail);
  });

  r.patch("/:name", async (c) => {
    const input = z
      .object({
        name: z.string().trim().min(3).max(512).optional(),
        metadata,
        efSearch: z.number().int().positive().optional(),
        profileId: z.string().nullable().optional(),
      })
      .parse(await c.req.json());
    const s = await load(c);
    const newName = input.name && input.name !== s.info.name ? input.name : undefined;
    const newConfiguration = input.efSearch
      ? isCloud(s.conn)
        ? { spann: { ef_search: input.efSearch } }
        : { hnsw: { ef_search: input.efSearch } }
      : undefined;
    if (newName || input.metadata !== undefined || newConfiguration) {
      assertWritable(store, s.connectionId);
      await s.rest.modifyCollection(s.tenant, s.database, s.info.id, {
        newName,
        newMetadata: input.metadata as CollectionInfo["metadata"],
        newConfiguration,
      });
    }
    if (input.profileId !== undefined) store.setBinding(s.connectionId, s.info.id, input.profileId);
    return c.json(await s.rest.getCollection(s.tenant, s.database, newName ?? s.info.name));
  });

  r.delete("/:name", async (c) => {
    const s = await load(c);
    await s.rest.deleteCollection(s.tenant, s.database, s.info.name);
    store.setBinding(s.connectionId, s.info.id, null);
    return c.body(null, 204);
  });

  // ---- records -----------------------------------------------------------

  r.post("/:name/records/get", async (c) => {
    const input = z
      .object({
        limit: z.number().int().min(1).max(1000).default(50),
        offset: z.number().int().min(0).default(0),
        ids: z.array(z.string()).optional(),
        where: filter,
        whereDocument: filter,
        includeEmbeddings: z.boolean().optional(),
      })
      .parse(await c.req.json());
    const s = await load(c);
    const filtered = Boolean(input.ids?.length || hasKeys(input.where) || hasKeys(input.whereDocument));
    const [raw, total] = await Promise.all([
      s.rest.get(s.tenant, s.database, s.info.id, {
        ...input,
        include: input.includeEmbeddings ? ["documents", "metadatas", "embeddings", "uris"] : ["documents", "metadatas", "uris"],
      }),
      filtered ? Promise.resolve(null) : s.rest.count(s.tenant, s.database, s.info.id),
    ]);
    const result: GetRecordsResult = { rows: toRows(raw), total };
    return c.json(result);
  });

  r.post("/:name/records/write", async (c) => {
    const input = z
      .object({
        mode: z.enum(["add", "update", "upsert"]),
        records: z
          .array(
            z.object({
              id: z.string().min(1),
              document: z.string().nullish(),
              metadata,
              embedding: z.array(z.number()).nullish(),
            }),
          )
          .min(1),
        embedMissing: z.boolean().default(true),
      })
      .parse(await c.req.json());
    const s = await load(c);
    const records = input.records.map((rec) => ({ ...rec }));

    const needEmbedding = records.filter((rec) => !rec.embedding && typeof rec.document === "string");
    if (input.mode !== "update" && records.some((rec) => !rec.embedding && typeof rec.document !== "string")) {
      throw new HTTPException(400, { message: "每条记录至少需要 document 或 embedding" });
    }
    if (needEmbedding.length && input.embedMissing) {
      const vectors = await embedderFor(s).generate(needEmbedding.map((rec) => rec.document as string));
      needEmbedding.forEach((rec, i) => (rec.embedding = vectors[i]));
    }

    for (let i = 0; i < records.length; i += WRITE_BATCH) {
      const chunk = records.slice(i, i + WRITE_BATCH);
      // Chroma needs a column to be present for every row, so rows with and
      // without vectors (e.g. metadata-only updates) go in separate requests.
      for (const part of [chunk.filter((rec) => rec.embedding), chunk.filter((rec) => !rec.embedding)]) {
        if (part.length) await s.rest.write(s.tenant, s.database, s.info.id, input.mode, recordBatch(part));
      }
    }
    return c.json({ written: records.length });
  });

  r.post("/:name/records/delete", async (c) => {
    const input = z
      .object({ ids: z.array(z.string()).optional(), where: filter, whereDocument: filter })
      .parse(await c.req.json());
    if (!input.ids?.length && !hasKeys(input.where) && !hasKeys(input.whereDocument)) {
      throw new HTTPException(400, { message: "删除需要指定 ids 或过滤条件" });
    }
    const s = await load(c);
    const res = await s.rest.delete(s.tenant, s.database, s.info.id, input);
    return c.json({ deleted: res?.deleted ?? input.ids?.length ?? null });
  });

  // ---- export --------------------------------------------------------------

  /** Streams every matching record as JSONL or CSV; filters arrive as JSON-encoded query params. */
  r.get("/:name/export", async (c) => {
    const input = z
      .object({
        format: z.enum(["jsonl", "csv"]).default("jsonl"),
        embeddings: z.enum(["0", "1"]).default("0"),
        where: z.string().optional(),
        whereDocument: z.string().optional(),
      })
      .parse(c.req.query());
    const parseFilter = (raw: string | undefined, label: string) => {
      if (!raw) return null;
      try {
        return filter.parse(JSON.parse(raw)) ?? null;
      } catch {
        throw new HTTPException(400, { message: `${label} 不是合法的 JSON 对象` });
      }
    };
    const where = parseFilter(input.where, "where");
    const whereDocument = parseFilter(input.whereDocument, "where_document");
    const withEmbeddings = input.embeddings === "1";
    const s = await load(c);

    c.header("content-type", input.format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson; charset=utf-8");
    c.header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${s.info.name}.${input.format}`)}`);
    return stream(c, async (out) => {
      if (input.format === "csv") await out.write(`﻿${csvLine(["id", "document", "metadata", ...(withEmbeddings ? ["embedding"] : [])])}`);
      for (let offset = 0; ; offset += EXPORT_BATCH) {
        if (out.aborted) return;
        const page = await s.rest.get(s.tenant, s.database, s.info.id, {
          offset,
          limit: EXPORT_BATCH,
          where,
          whereDocument,
          include: withEmbeddings ? ["documents", "metadatas", "embeddings", "uris"] : ["documents", "metadatas", "uris"],
        });
        const rows = toRows(page);
        const lines = rows.map((row) => {
          if (input.format === "jsonl") {
            const { embedding, uri, ...rest } = row;
            return `${JSON.stringify({ ...rest, ...(uri ? { uri } : {}), ...(withEmbeddings ? { embedding: embedding ?? null } : {}) })}\n`;
          }
          const cells = [row.id, row.document ?? "", row.metadata ? JSON.stringify(row.metadata) : ""];
          if (withEmbeddings) cells.push(row.embedding ? JSON.stringify(row.embedding) : "");
          return csvLine(cells);
        });
        if (lines.length) await out.write(lines.join(""));
        if (rows.length < EXPORT_BATCH) return;
      }
    });
  });

  // ---- search ------------------------------------------------------------

  r.post("/:name/search", async (c) => {
    const input = z
      .object({
        text: z.string().optional(),
        recordId: z.string().optional(),
        embedding: z.array(z.number()).optional(),
        nResults: z.number().int().min(1).max(500).default(10),
        where: filter,
        whereDocument: filter,
        includeEmbeddings: z.boolean().optional(),
      })
      .parse(await c.req.json());
    const s = await load(c);
    const t0 = Date.now();
    let queryEmbedding: number[];
    if (input.embedding?.length) {
      queryEmbedding = input.embedding;
    } else if (input.recordId) {
      const raw = await s.rest.get(s.tenant, s.database, s.info.id, { ids: [input.recordId], include: ["embeddings"] });
      if (!raw.embeddings?.[0]) throw new HTTPException(404, { message: `记录不存在或没有向量：${input.recordId}` });
      queryEmbedding = raw.embeddings[0];
    } else if (input.text?.trim()) {
      [queryEmbedding] = await embedderFor(s).generate([input.text]);
    } else {
      throw new HTTPException(400, { message: "请输入查询文本" });
    }
    const embedMs = Date.now() - t0;
    if (s.info.dimension && queryEmbedding.length !== s.info.dimension) {
      throw new HTTPException(400, {
        message: `向量维度不匹配：查询向量 ${queryEmbedding.length} 维，集合为 ${s.info.dimension} 维。请检查集合绑定的 Embedding 配置是否与写入时一致。`,
      });
    }
    const raw = await s.rest.query(s.tenant, s.database, s.info.id, {
      queryEmbeddings: [queryEmbedding],
      nResults: input.nResults,
      where: input.where,
      whereDocument: input.whereDocument,
      include: ["documents", "metadatas", "distances", "uris", ...(input.includeEmbeddings ? (["embeddings"] as const) : [])],
    });
    const space = spaceOf(s.info);
    const result: SearchResult = {
      space,
      queryEmbedding,
      embedMs,
      tookMs: Date.now() - t0,
      hits: (raw.ids[0] ?? []).map((id, i) => {
        const distance = raw.distances?.[0]?.[i] ?? NaN;
        return {
          id,
          document: raw.documents?.[0]?.[i] ?? null,
          metadata: raw.metadatas?.[0]?.[i] ?? null,
          embedding: raw.embeddings?.[0]?.[i] ?? undefined,
          distance,
          similarity: similarity(space, distance),
        };
      }),
    };
    return c.json(result);
  });

  // ---- projection (scatter plot) -----------------------------------------

  r.post("/:name/projection", async (c) => {
    const input = z
      .object({
        limit: z.number().int().min(10).max(10000).default(2000),
        where: filter,
        components: z.number().int().min(2).max(64).default(32),
      })
      .parse(await c.req.json());
    const s = await load(c);
    const filtered = hasKeys(input.where);
    const total = filtered ? null : await s.rest.count(s.tenant, s.database, s.info.id);
    const include = ["embeddings", "documents", "metadatas"] as const;

    // Evenly spaced windows give a cheap, deterministic sample of large collections.
    const windows: Array<{ offset: number; limit: number }> = [];
    if (total !== null && total > input.limit) {
      const size = 250;
      const n = Math.ceil(input.limit / size);
      const stride = total / n;
      for (let i = 0; i < n; i++) windows.push({ offset: Math.floor(i * stride), limit: Math.min(size, input.limit - i * size) });
    } else {
      for (let off = 0; off < (total ?? input.limit); off += 500) windows.push({ offset: off, limit: Math.min(500, input.limit - off) });
    }
    const pages = await mapLimit(windows, 4, (w) =>
      s.rest.get(s.tenant, s.database, s.info.id, { ...w, where: input.where, include: [...include] }),
    );
    const rows = pages.flatMap(toRows).filter((row) => row.embedding?.length);
    const { scores, explainedVariance } = pca(rows.map((row) => row.embedding!), input.components);
    const result: ProjectionResult = {
      ids: rows.map((row) => row.id),
      documents: rows.map((row) => (row.document && row.document.length > 400 ? `${row.document.slice(0, 400)}…` : row.document)),
      metadatas: rows.map((row) => row.metadata),
      scores: scores.map((v) => v.map((x) => Math.round(x * 1e5) / 1e5)),
      explainedVariance,
      dimension: rows[0]?.embedding?.length ?? 0,
      total: total ?? rows.length,
      sampled: rows.length,
    };
    return c.json(result);
  });

  return r;
}

function csvLine(cells: string[]) {
  return `${cells.map((v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")}\r\n`;
}

function hasKeys(o: Record<string, unknown> | null | undefined) {
  return Boolean(o && Object.keys(o).length);
}

export function toRows(raw: RawGetResult): RecordRow[] {
  return raw.ids.map((id, i) => ({
    id,
    document: raw.documents?.[i] ?? null,
    metadata: raw.metadatas?.[i] ?? null,
    embedding: raw.embeddings?.[i] ?? undefined,
    uri: raw.uris?.[i] ?? null,
  }));
}

/** Only send columns that at least one record sets, so omitted fields stay untouched on update. */
function recordBatch(records: Array<{ id: string; document?: string | null; metadata?: unknown; embedding?: number[] | null }>): RecordBatch {
  const batch: RecordBatch = { ids: records.map((r) => r.id) };
  if (records.some((r) => r.embedding)) batch.embeddings = records.map((r) => r.embedding!);
  if (records.some((r) => r.document !== undefined)) batch.documents = records.map((r) => r.document ?? null);
  if (records.some((r) => r.metadata !== undefined)) batch.metadatas = records.map((r) => (r.metadata ?? null) as Metadata | null);
  return batch;
}
