import type {
  AppSettings,
  CollectionDetail,
  CollectionInfo,
  ConnectionInput,
  ConnectionPublic,
  ConnectionStatus,
  CreateCollectionInput,
  DatabaseInfo,
  DeleteRecordsInput,
  EmbeddingProfileInput,
  EmbeddingProfilePublic,
  GetRecordsInput,
  GetRecordsResult,
  MigrationInput,
  MigrationJob,
  ProjectionInput,
  ProjectionResult,
  SearchInput,
  SearchResult,
  UpdateCollectionInput,
  WriteRecordsInput,
} from "@shared/types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? (typeof data === "string" && data ? data : res.statusText);
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

const enc = encodeURIComponent;
const col = (cid: string, db: string, name?: string) =>
  `/connections/${enc(cid)}/databases/${enc(db)}/collections${name ? `/${enc(name)}` : ""}`;

export type CollectionWithCount = CollectionInfo & { count: number | null };

export const api = {
  connections: {
    list: () => request<ConnectionPublic[]>("GET", "/connections"),
    create: (input: ConnectionInput) => request<ConnectionPublic>("POST", "/connections", input),
    update: (id: string, input: ConnectionInput) => request<ConnectionPublic>("PUT", `/connections/${enc(id)}`, input),
    remove: (id: string) => request<void>("DELETE", `/connections/${enc(id)}`),
    test: (input: ConnectionInput) => request<ConnectionStatus>("POST", "/connections/test", input),
    status: (id: string) => request<ConnectionStatus>("GET", `/connections/${enc(id)}/status`),
  },
  databases: {
    list: (cid: string) => request<DatabaseInfo[]>("GET", `/connections/${enc(cid)}/databases`),
    create: (cid: string, name: string) => request<void>("POST", `/connections/${enc(cid)}/databases`, { name }),
    remove: (cid: string, db: string) => request<void>("DELETE", `/connections/${enc(cid)}/databases/${enc(db)}`),
  },
  collections: {
    list: (cid: string, db: string) => request<CollectionWithCount[]>("GET", `${col(cid, db)}?counts=1`),
    get: (cid: string, db: string, name: string) => request<CollectionDetail>("GET", col(cid, db, name)),
    create: (cid: string, db: string, input: CreateCollectionInput) => request<CollectionInfo>("POST", col(cid, db), input),
    update: (cid: string, db: string, name: string, input: UpdateCollectionInput) =>
      request<CollectionInfo>("PATCH", col(cid, db, name), input),
    remove: (cid: string, db: string, name: string) => request<void>("DELETE", col(cid, db, name)),
  },
  records: {
    get: (cid: string, db: string, name: string, input: GetRecordsInput, signal?: AbortSignal) =>
      request<GetRecordsResult>("POST", `${col(cid, db, name)}/records/get`, input, signal),
    write: (cid: string, db: string, name: string, input: WriteRecordsInput) =>
      request<{ written: number }>("POST", `${col(cid, db, name)}/records/write`, input),
    remove: (cid: string, db: string, name: string, input: DeleteRecordsInput) =>
      request<{ deleted: number | null }>("POST", `${col(cid, db, name)}/records/delete`, input),
  },
  /** Download URL for a streamed JSONL / CSV export of the records matching `filters`. */
  exportUrl: (cid: string, db: string, name: string, opts: { format: "jsonl" | "csv"; embeddings: boolean; where?: unknown; whereDocument?: unknown }) => {
    const q = new URLSearchParams({ format: opts.format, embeddings: opts.embeddings ? "1" : "0" });
    if (opts.where) q.set("where", JSON.stringify(opts.where));
    if (opts.whereDocument) q.set("whereDocument", JSON.stringify(opts.whereDocument));
    return `/api${col(cid, db, name)}/export?${q}`;
  },
  search: (cid: string, db: string, name: string, input: SearchInput) =>
    request<SearchResult>("POST", `${col(cid, db, name)}/search`, input),
  projection: (cid: string, db: string, name: string, input: ProjectionInput, signal?: AbortSignal) =>
    request<ProjectionResult>("POST", `${col(cid, db, name)}/projection`, input, signal),
  profiles: {
    list: () => request<EmbeddingProfilePublic[]>("GET", "/embedding-profiles"),
    create: (input: EmbeddingProfileInput) => request<EmbeddingProfilePublic>("POST", "/embedding-profiles", input),
    update: (id: string, input: EmbeddingProfileInput) =>
      request<EmbeddingProfilePublic>("PUT", `/embedding-profiles/${enc(id)}`, input),
    remove: (id: string) => request<void>("DELETE", `/embedding-profiles/${enc(id)}`),
    test: (input: EmbeddingProfileInput) =>
      request<{ ok: boolean; dimension?: number; latencyMs: number; sample?: number[]; error?: string }>(
        "POST",
        "/embedding-profiles/test",
        input,
      ),
  },
  settings: {
    get: () => request<AppSettings>("GET", "/settings"),
    save: (s: AppSettings) => request<AppSettings>("PUT", "/settings", s),
  },
  migrations: {
    list: () => request<MigrationJob[]>("GET", "/migrations"),
    start: (input: MigrationInput) => request<MigrationJob>("POST", "/migrations", input),
    cancel: (id: string) => request<void>("POST", `/migrations/${enc(id)}/cancel`),
    events: (id: string) => new EventSource(`/api/migrations/${enc(id)}/events`),
  },
};
