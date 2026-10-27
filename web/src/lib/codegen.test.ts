import { describe, expect, it } from "vitest";
import { type CodeTarget, generateCode } from "./codegen";

const local: CodeTarget = { url: "http://localhost:8010", authType: "x-chroma-token", tenant: "default_tenant", database: "db", collectionName: "docs", collectionId: "c-1" };
const where = { $and: [{ kind: "fruit" }, { ok: true }, { gone: null }] };

describe("generateCode", () => {
  it("writes Python literals and HttpClient options", () => {
    const code = generateCode("python", local, { kind: "query", text: "apples", nResults: 5, where });
    expect(code).toContain('chromadb.HttpClient(host="localhost", port=8010, ssl=False, headers={"X-Chroma-Token": "<YOUR_TOKEN>"}');
    expect(code).toContain('query_texts=["apples"], n_results=5, where={"$and": [{"kind": "fruit"}, {"ok": True}, {"gone": None}]}');
  });

  it("looks up the record's vector for find-similar", () => {
    const code = generateCode("js", local, { kind: "query", recordId: "a", nResults: 3 });
    expect(code).toContain('collection.get({ ids: ["a"], include: ["embeddings"] })');
    expect(code).toContain("queryEmbeddings: ref.embeddings, nResults: 3");
  });

  it("uses CloudClient for Chroma Cloud", () => {
    const cloud = { ...local, url: "https://api.trychroma.com" };
    expect(generateCode("python", cloud, { kind: "get", limit: 10, offset: 0 })).toContain("chromadb.CloudClient(api_key=");
    expect(generateCode("js", cloud, { kind: "get", limit: 10, offset: 0 })).toContain("new CloudClient(");
  });

  it("sends the searched vector over REST and shell-quotes the body", () => {
    const code = generateCode("curl", local, { kind: "query", text: "it's", queryEmbedding: [0.5, 1], nResults: 2, whereDocument: { $contains: "it's" } });
    expect(code).toContain("'http://localhost:8010/api/v2/tenants/default_tenant/databases/db/collections/c-1/query'");
    expect(code).toContain(`"query_embeddings":[[0.5,1]]`);
    expect(code).toContain(`it'\\''s`);
  });
});
