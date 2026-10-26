// Integration tests against a real Chroma 1.x server.
//   docker compose up -d   (Chroma on :8010)
//   pnpm test
// Skipped automatically when Chroma is unreachable. A fake OpenAI-compatible
// embeddings server stands in for the hosted provider.

import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CollectionDetail, GetRecordsResult, MigrationJob, SearchResult } from "../shared/types.ts";
import { createApp } from "./app.ts";
import { ConfigStore } from "./config-store.ts";

const CHROMA_URL = process.env.TEST_CHROMA_URL ?? "http://localhost:8010";
const reachable = await fetch(`${CHROMA_URL}/api/v2/heartbeat`, { signal: AbortSignal.timeout(2000) }).then(
  (r) => r.ok,
  () => false,
);

/** Deterministic 64-dim bag-of-words vectors: shared words → close vectors. */
function fakeEmbed(text: string) {
  const v = new Array(64).fill(0);
  for (const w of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % 64] += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

describe.skipIf(!reachable)("API against Chroma", () => {
  const { app } = createApp(new ConfigStore(mkdtempSync(join(tmpdir(), "chromadb-gui-test-"))));
  const db = `test_${Date.now()}`;
  let cid = "";
  let embedServer: Server;
  let embedCalls = 0;

  const call = async <T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> => {
    const res = await app.request(`/api${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
  };
  const col = (name = "") => `/connections/${cid}/databases/${db}/collections${name ? `/${name}` : ""}`;

  beforeAll(async () => {
    embedServer = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        embedCalls++;
        const { input } = JSON.parse(body) as { input: string[] };
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: input.map((t, index) => ({ index, embedding: fakeEmbed(t) })) }));
      });
    });
    await new Promise<void>((r) => embedServer.listen(0, "127.0.0.1", r));
    const port = (embedServer.address() as { port: number }).port;

    cid = (await call<{ id: string }>("POST", "/connections", { name: "test", url: CHROMA_URL, authType: "none" })).data.id;
    expect((await call("POST", `/connections/${cid}/databases`, { name: db })).status).toBe(201);
    const profile = await call<{ id: string }>("POST", "/embedding-profiles", {
      name: "fake",
      type: "openai",
      model: "fake-embed-64",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "sk-test",
    });
    expect(profile.status).toBe(201);
    const created = await call("POST", col(), { name: "docs", space: "cosine", profileId: profile.data.id, metadata: { purpose: "test" } });
    expect(created.status).toBe(201);
  });

  afterAll(async () => {
    await call("DELETE", `/connections/${cid}/databases/${db}`);
    embedServer?.close();
  });

  it("reports connection status", async () => {
    const { data } = await call<{ ok: boolean; databases: string[] }>("GET", `/connections/${cid}/status`);
    expect(data.ok).toBe(true);
    expect(data.databases).toContain(db);
  });

  it("does not leak secrets", async () => {
    const { data } = await call<Array<Record<string, unknown>>>("GET", "/embedding-profiles");
    const fake = data.find((p) => p.name === "fake")!;
    expect(fake.apiKey).toBeUndefined();
    expect(fake.hasApiKey).toBe(true);
  });

  it("writes documents, embedding them with the bound profile", async () => {
    const before = embedCalls;
    const { status } = await call("POST", `${col("docs")}/records/write`, {
      mode: "add",
      records: [
        { id: "a", document: "red apples and green apples", metadata: { kind: "fruit", n: 1 } },
        { id: "b", document: "fast cars on the race track", metadata: { kind: "vehicle", n: 2 } },
        { id: "c", document: "apples bananas and pears", metadata: { kind: "fruit", n: 3 } },
      ],
    });
    expect(status).toBe(200);
    expect(embedCalls).toBe(before + 1);

    const { data } = await call<CollectionDetail>("GET", col("docs"));
    expect(data.count).toBe(3);
    expect(data.space).toBe("cosine");
    expect(data.embedding.profileName).toBe("fake");
    expect(data.configuration.embedding_function?.name).toBe("openai");
  });

  it("pages and filters records", async () => {
    const page = await call<GetRecordsResult>("POST", `${col("docs")}/records/get`, { limit: 2, offset: 0 });
    expect(page.data.rows).toHaveLength(2);
    expect(page.data.total).toBe(3);

    const filtered = await call<GetRecordsResult>("POST", `${col("docs")}/records/get`, {
      where: { $and: [{ kind: "fruit" }, { n: { $gt: 1 } }] },
    });
    expect(filtered.data.rows.map((r) => r.id)).toEqual(["c"]);
    expect(filtered.data.total).toBeNull();

    const byDoc = await call<GetRecordsResult>("POST", `${col("docs")}/records/get`, { whereDocument: { $contains: "race" } });
    expect(byDoc.data.rows.map((r) => r.id)).toEqual(["b"]);
  });

  it("searches by text and by record", async () => {
    const text = await call<SearchResult>("POST", `${col("docs")}/search`, { text: "apples", nResults: 3 });
    expect(text.status).toBe(200);
    expect(text.data.hits[0].id).not.toBe("b");
    expect(text.data.hits.at(-1)!.id).toBe("b");
    expect(text.data.hits[0].similarity).toBeCloseTo(1 - text.data.hits[0].distance);

    const similar = await call<SearchResult>("POST", `${col("docs")}/search`, { recordId: "a", nResults: 1 });
    expect(similar.data.hits[0].id).toBe("a");
    expect(similar.data.hits[0].distance).toBeCloseTo(0, 5);
  });

  it("updates metadata without touching the vector, and re-embeds changed documents", async () => {
    const vec = async () =>
      (await call<GetRecordsResult>("POST", `${col("docs")}/records/get`, { ids: ["a"], includeEmbeddings: true })).data.rows[0];

    const original = await vec();
    await call("POST", `${col("docs")}/records/write`, { mode: "update", records: [{ id: "a", metadata: { kind: "fruit", n: null, tag: "x" } }] });
    const metaOnly = await vec();
    expect(metaOnly.metadata).toEqual({ kind: "fruit", tag: "x" });
    expect(metaOnly.embedding).toEqual(original.embedding);

    await call("POST", `${col("docs")}/records/write`, { mode: "update", records: [{ id: "a", document: "a fast race car" }] });
    const reembedded = await vec();
    expect(reembedded.document).toBe("a fast race car");
    expect(reembedded.embedding).not.toEqual(original.embedding);
  });

  it("projects vectors with PCA", async () => {
    const { data } = await call<{ scores: number[][]; sampled: number; dimension: number }>("POST", `${col("docs")}/projection`, { components: 2 });
    expect(data.sampled).toBe(3);
    expect(data.dimension).toBe(64);
    expect(data.scores.every((s) => s.length === 2)).toBe(true);
  });

  it("rejects text search when no embedding is available", async () => {
    await call("POST", col(), { name: "raw_vectors" });
    await call("POST", `${col("raw_vectors")}/records/write`, { mode: "add", records: [{ id: "x", embedding: [1, 0, 0] }] });
    const res = await call<{ error: string }>("POST", `${col("raw_vectors")}/search`, { text: "hello" });
    expect(res.status).toBe(400);
    expect(res.data.error).toMatch(/Embedding/);
    const byVector = await call<SearchResult>("POST", `${col("raw_vectors")}/search`, { embedding: [1, 0, 0], nResults: 1 });
    expect(byVector.data.hits[0].id).toBe("x");
  });

  it("copies a collection with its vectors and configuration", async () => {
    const start = await call<MigrationJob>("POST", "/migrations", {
      source: { connectionId: cid, database: db, collection: "docs" },
      target: { connectionId: cid, database: db, collection: "docs_copy" },
      mode: "create",
      batchSize: 2,
    });
    expect(start.status).toBe(201);
    let job = start.data;
    for (let i = 0; i < 50 && job.state === "running"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      job = (await call<MigrationJob[]>("GET", "/migrations")).data.find((j) => j.id === job.id)!;
    }
    expect(job.state).toBe("done");
    expect(job.copied).toBe(3);

    const copy = await call<CollectionDetail>("GET", col("docs_copy"));
    expect(copy.data.count).toBe(3);
    expect(copy.data.space).toBe("cosine");
    expect(copy.data.configuration.embedding_function?.name).toBe("openai");
  });

  it("renames and deletes collections", async () => {
    expect((await call("PATCH", col("docs_copy"), { name: "docs_renamed", efSearch: 50 })).status).toBe(200);
    const renamed = await call<CollectionDetail>("GET", col("docs_renamed"));
    expect(renamed.data.configuration.hnsw?.ef_search).toBe(50);
    expect((await call("DELETE", col("docs_renamed"))).status).toBe(204);
    expect((await call("GET", col("docs_renamed"))).status).toBe(404);
  });

  it("validates input", async () => {
    const res = await call<{ error: string }>("POST", col(), { name: "x" });
    expect(res.status).toBe(400);
    expect(res.data.error).toMatch(/3/);
  });
});
