// Thin client over Chroma's REST API v2.
// We deliberately avoid the official JS client's Collection wrapper: it tries to
// instantiate the embedding function declared in a collection's configuration,
// which fails for EFs that are not installed locally. A GUI must be able to open
// any collection, so we speak raw HTTP and handle embeddings ourselves.

import type {
  CollectionConfigurationJson,
  CollectionInfo,
  ConnectionConfig,
  DatabaseInfo,
  Metadata,
} from "../shared/types.ts";

export class ChromaHttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public kind?: string,
  ) {
    super(message);
  }
}

type Include = "documents" | "metadatas" | "embeddings" | "distances" | "uris";

export interface RawGetResult {
  ids: string[];
  documents: (string | null)[] | null;
  metadatas: (Metadata | null)[] | null;
  embeddings: number[][] | null;
  uris: (string | null)[] | null;
}

export interface RawQueryResult {
  ids: string[][];
  documents: (string | null)[][] | null;
  metadatas: (Metadata | null)[][] | null;
  embeddings: number[][][] | null;
  distances: number[][] | null;
}

interface RawCollection {
  id: string;
  name: string;
  tenant: string;
  database: string;
  metadata: Metadata | null;
  configuration_json: CollectionConfigurationJson;
  dimension?: number | null;
}

type Filter = Record<string, unknown> | null | undefined;

export interface RecordBatch {
  ids: string[];
  embeddings?: number[][];
  documents?: (string | null)[];
  metadatas?: (Metadata | null)[];
  uris?: (string | null)[];
}

const enc = encodeURIComponent;
const emptyToUndef = (f: Filter) => (f && Object.keys(f).length ? f : undefined);

export class ChromaRest {
  private base: string;
  private headers: Record<string, string>;

  constructor(conn: Pick<ConnectionConfig, "url" | "authType" | "credentials">, private timeoutMs = 30_000) {
    this.base = conn.url.replace(/\/+$/, "");
    this.headers = { "content-type": "application/json" };
    const cred = conn.credentials ?? "";
    if (conn.authType === "x-chroma-token") this.headers["x-chroma-token"] = cred;
    else if (conn.authType === "bearer") this.headers["authorization"] = `Bearer ${cred}`;
    else if (conn.authType === "basic") this.headers["authorization"] = `Basic ${Buffer.from(cred).toString("base64")}`;
  }

  async request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/api/v2${path}`, {
        method,
        headers: this.headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const cause = (e as { cause?: { code?: string } }).cause?.code;
      throw new ChromaHttpError(502, `无法连接 Chroma (${this.base})：${cause ?? (e as Error).message}`, "ConnectionError");
    }
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg = (data as { message?: string; error?: string } | null)?.message
        ?? (data as { error?: string } | null)?.error
        ?? (text || res.statusText);
      throw new ChromaHttpError(res.status, msg, (data as { error?: string } | null)?.error);
    }
    return data as T;
  }

  // ---- server --------------------------------------------------------

  version() {
    return this.request<string>("GET", "/version");
  }

  heartbeat() {
    return this.request<Record<string, number>>("GET", "/heartbeat");
  }

  identity() {
    return this.request<{ user_id: string; tenant: string; databases: string[] }>("GET", "/auth/identity");
  }

  // ---- databases -----------------------------------------------------

  listDatabases(tenant: string) {
    return this.request<DatabaseInfo[]>("GET", `/tenants/${enc(tenant)}/databases?limit=1000`);
  }

  createDatabase(tenant: string, name: string) {
    return this.request<unknown>("POST", `/tenants/${enc(tenant)}/databases`, { name });
  }

  deleteDatabase(tenant: string, name: string) {
    return this.request<unknown>("DELETE", `/tenants/${enc(tenant)}/databases/${enc(name)}`);
  }

  // ---- collections ---------------------------------------------------

  private db(tenant: string, database: string) {
    return `/tenants/${enc(tenant)}/databases/${enc(database)}`;
  }

  async listCollections(tenant: string, database: string): Promise<CollectionInfo[]> {
    const out: CollectionInfo[] = [];
    const page = 100;
    for (let offset = 0; ; offset += page) {
      const batch = await this.request<RawCollection[]>(
        "GET",
        `${this.db(tenant, database)}/collections?limit=${page}&offset=${offset}`,
      );
      out.push(...batch.map(toInfo));
      if (batch.length < page) return out;
    }
  }

  async getCollection(tenant: string, database: string, name: string): Promise<CollectionInfo> {
    return toInfo(await this.request<RawCollection>("GET", `${this.db(tenant, database)}/collections/${enc(name)}`));
  }

  async createCollection(
    tenant: string,
    database: string,
    args: { name: string; metadata?: Metadata | null; configuration?: CollectionConfigurationJson },
  ): Promise<CollectionInfo> {
    const body = { name: args.name, metadata: args.metadata ?? undefined, configuration: args.configuration, get_or_create: false };
    return toInfo(await this.request<RawCollection>("POST", `${this.db(tenant, database)}/collections`, body));
  }

  modifyCollection(
    tenant: string,
    database: string,
    id: string,
    args: { newName?: string; newMetadata?: Metadata | null; newConfiguration?: Record<string, unknown> },
  ) {
    return this.request<unknown>("PUT", `${this.db(tenant, database)}/collections/${enc(id)}`, {
      new_name: args.newName,
      new_metadata: args.newMetadata ?? undefined,
      new_configuration: args.newConfiguration,
    });
  }

  deleteCollection(tenant: string, database: string, name: string) {
    return this.request<unknown>("DELETE", `${this.db(tenant, database)}/collections/${enc(name)}`);
  }

  async forkCollection(tenant: string, database: string, id: string, newName: string): Promise<CollectionInfo> {
    return toInfo(
      await this.request<RawCollection>("POST", `${this.db(tenant, database)}/collections/${enc(id)}/fork`, { new_name: newName }),
    );
  }

  // ---- records -------------------------------------------------------

  private col(tenant: string, database: string, id: string) {
    return `${this.db(tenant, database)}/collections/${enc(id)}`;
  }

  count(tenant: string, database: string, id: string, signal?: AbortSignal) {
    return this.request<number>("GET", `${this.col(tenant, database, id)}/count`, undefined, signal);
  }

  get(
    tenant: string,
    database: string,
    id: string,
    args: { ids?: string[]; where?: Filter; whereDocument?: Filter; limit?: number; offset?: number; include: Include[] },
    signal?: AbortSignal,
  ) {
    return this.request<RawGetResult>("POST", `${this.col(tenant, database, id)}/get`, {
      ids: args.ids,
      where: emptyToUndef(args.where),
      where_document: emptyToUndef(args.whereDocument),
      limit: args.limit,
      offset: args.offset,
      include: args.include,
    }, signal);
  }

  query(
    tenant: string,
    database: string,
    id: string,
    args: { queryEmbeddings: number[][]; nResults: number; where?: Filter; whereDocument?: Filter; include: Include[] },
  ) {
    return this.request<RawQueryResult>("POST", `${this.col(tenant, database, id)}/query`, {
      query_embeddings: args.queryEmbeddings,
      n_results: args.nResults,
      where: emptyToUndef(args.where),
      where_document: emptyToUndef(args.whereDocument),
      include: args.include,
    });
  }

  write(tenant: string, database: string, id: string, mode: "add" | "update" | "upsert", batch: RecordBatch, signal?: AbortSignal) {
    return this.request<unknown>("POST", `${this.col(tenant, database, id)}/${mode}`, batch, signal);
  }

  delete(tenant: string, database: string, id: string, args: { ids?: string[]; where?: Filter; whereDocument?: Filter }) {
    return this.request<{ deleted?: number } | null>("POST", `${this.col(tenant, database, id)}/delete`, {
      ids: args.ids,
      where: emptyToUndef(args.where),
      where_document: emptyToUndef(args.whereDocument),
    });
  }
}

function toInfo(raw: RawCollection): CollectionInfo {
  return {
    id: raw.id,
    name: raw.name,
    tenant: raw.tenant,
    database: raw.database,
    metadata: raw.metadata ?? null,
    configuration: raw.configuration_json ?? {},
    dimension: raw.dimension ?? null,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
