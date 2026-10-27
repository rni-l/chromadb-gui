// Turns what the GUI just did into equivalent chromadb client code (Python, JS) and a curl call
// against the REST v2 API. Secrets are never available in the browser, so auth uses placeholders.

import type { AuthType } from "@shared/types";

export interface CodeTarget {
  url: string;
  authType: AuthType;
  tenant: string;
  database: string;
  collectionName: string;
  collectionId: string;
}

type Filter = Record<string, unknown> | null | undefined;

export type CodeOp =
  | { kind: "get"; where?: Filter; whereDocument?: Filter; limit: number; offset: number }
  | {
      kind: "query";
      text?: string;
      recordId?: string;
      embedding?: number[];
      /** The vector the server actually searched with; curl needs it since REST cannot embed text. */
      queryEmbedding?: number[];
      nResults: number;
      where?: Filter;
      whereDocument?: Filter;
    };

export type CodeLang = "python" | "js" | "curl";

const isCloudUrl = (url: string) => /trychroma\.com/i.test(url);

function authHeaders(authType: AuthType): Record<string, string> {
  if (authType === "x-chroma-token") return { "X-Chroma-Token": "<YOUR_TOKEN>" };
  if (authType === "bearer") return { Authorization: "Bearer <YOUR_TOKEN>" };
  if (authType === "basic") return { Authorization: "Basic <BASE64(user:password)>" };
  return {};
}

function hostPort(url: string) {
  const u = new URL(url);
  const ssl = u.protocol === "https:";
  return { host: u.hostname, port: Number(u.port) || (ssl ? 443 : 8000), ssl };
}

const has = (f: Filter): f is Record<string, unknown> => Boolean(f && Object.keys(f).length);

/** JSON → Python literal (True/False/None). */
function py(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number" || typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(py).join(", ")}]`;
  return `{${Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${JSON.stringify(k)}: ${py(x)}`)
    .join(", ")}}`;
}

const js = (v: unknown) => JSON.stringify(v);

function python(t: CodeTarget, op: CodeOp) {
  const lines = ["import chromadb", ""];
  if (isCloudUrl(t.url)) {
    lines.push(`client = chromadb.CloudClient(api_key="<YOUR_API_KEY>", tenant=${py(t.tenant)}, database=${py(t.database)})`);
  } else {
    const { host, port, ssl } = hostPort(t.url);
    const headers = authHeaders(t.authType);
    const args = [`host=${py(host)}`, `port=${port}`, `ssl=${py(ssl)}`];
    if (Object.keys(headers).length) args.push(`headers=${py(headers)}`);
    args.push(`tenant=${py(t.tenant)}`, `database=${py(t.database)}`);
    lines.push(`client = chromadb.HttpClient(${args.join(", ")})`);
  }
  lines.push(`collection = client.get_collection(${py(t.collectionName)})`, "");

  const filters = (where: Filter, whereDocument: Filter) => [
    ...(has(where) ? [`where=${py(where)}`] : []),
    ...(has(whereDocument) ? [`where_document=${py(whereDocument)}`] : []),
  ];
  if (op.kind === "get") {
    lines.push(`results = collection.get(${[...filters(op.where, op.whereDocument), `limit=${op.limit}`, `offset=${op.offset}`].join(", ")})`);
  } else {
    let query: string;
    if (op.embedding) query = `query_embeddings=[${py(op.embedding)}]`;
    else if (op.recordId) {
      lines.push(`ref = collection.get(ids=[${py(op.recordId)}], include=["embeddings"])`);
      query = `query_embeddings=ref["embeddings"]`;
    } else {
      lines.push("# query_texts 会用集合的 embedding function 向量化，本机需要能实例化它（必要时 get_collection 时传 embedding_function=…）");
      query = `query_texts=[${py(op.text ?? "")}]`;
    }
    lines.push(`results = collection.query(${[query, `n_results=${op.nResults}`, ...filters(op.where, op.whereDocument)].join(", ")})`);
  }
  return lines.join("\n");
}

function javascript(t: CodeTarget, op: CodeOp) {
  const lines: string[] = [];
  if (isCloudUrl(t.url)) {
    lines.push(`import { CloudClient } from "chromadb";`, "");
    lines.push(`const client = new CloudClient({ apiKey: "<YOUR_API_KEY>", tenant: ${js(t.tenant)}, database: ${js(t.database)} });`);
  } else {
    const { host, port, ssl } = hostPort(t.url);
    const headers = authHeaders(t.authType);
    const opts = [`host: ${js(host)}`, `port: ${port}`, `ssl: ${ssl}`, `tenant: ${js(t.tenant)}`, `database: ${js(t.database)}`];
    if (Object.keys(headers).length) opts.push(`headers: ${js(headers)}`);
    lines.push(`import { ChromaClient } from "chromadb";`, "", `const client = new ChromaClient({ ${opts.join(", ")} });`);
  }
  lines.push(`const collection = await client.getCollection({ name: ${js(t.collectionName)} });`, "");

  const filters = (where: Filter, whereDocument: Filter) => [
    ...(has(where) ? [`where: ${js(where)}`] : []),
    ...(has(whereDocument) ? [`whereDocument: ${js(whereDocument)}`] : []),
  ];
  if (op.kind === "get") {
    lines.push(`const results = await collection.get({ ${[...filters(op.where, op.whereDocument), `limit: ${op.limit}`, `offset: ${op.offset}`].join(", ")} });`);
  } else {
    let query: string;
    if (op.embedding) query = `queryEmbeddings: [${js(op.embedding)}]`;
    else if (op.recordId) {
      lines.push(`const ref = await collection.get({ ids: [${js(op.recordId)}], include: ["embeddings"] });`);
      query = "queryEmbeddings: ref.embeddings";
    } else {
      lines.push("// queryTexts 会用集合的 embedding function 向量化，需要安装对应的 @chroma-core/* 包");
      query = `queryTexts: [${js(op.text ?? "")}]`;
    }
    lines.push(`const results = await collection.query({ ${[query, `nResults: ${op.nResults}`, ...filters(op.where, op.whereDocument)].join(", ")} });`);
  }
  return lines.join("\n");
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function curl(t: CodeTarget, op: CodeOp) {
  const base = `${t.url.replace(/\/+$/, "")}/api/v2/tenants/${encodeURIComponent(t.tenant)}/databases/${encodeURIComponent(t.database)}/collections/${t.collectionId}`;
  const headers = { "Content-Type": "application/json", ...authHeaders(t.authType), ...(isCloudUrl(t.url) ? { "X-Chroma-Token": "<YOUR_API_KEY>" } : {}) };
  const body: Record<string, unknown> = {};
  const comment: string[] = [];
  if (op.kind === "get") {
    Object.assign(body, { limit: op.limit, offset: op.offset, include: ["documents", "metadatas"] });
  } else {
    const vec = op.embedding ?? op.queryEmbedding;
    if (!op.embedding) comment.push(`# REST API 不做向量化：下面的向量是本工具为${op.recordId ? `记录 ${op.recordId}` : "这段文本"}取得的查询向量`);
    Object.assign(body, { query_embeddings: [vec ?? "<VECTOR>"], n_results: op.nResults, include: ["documents", "metadatas", "distances"] });
  }
  if (has(op.where)) body.where = op.where;
  if (has(op.whereDocument)) body.where_document = op.whereDocument;
  return [
    ...comment,
    `curl -X POST ${shq(`${base}/${op.kind}`)} \\`,
    ...Object.entries(headers).map(([k, v]) => `  -H ${shq(`${k}: ${v}`)} \\`),
    `  -d ${shq(JSON.stringify(body))}`,
  ].join("\n");
}

export function generateCode(lang: CodeLang, target: CodeTarget, op: CodeOp) {
  return lang === "python" ? python(target, op) : lang === "js" ? javascript(target, op) : curl(target, op);
}
