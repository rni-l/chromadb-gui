// DTOs shared between the Hono server and the React client.

export type AuthType = "none" | "x-chroma-token" | "bearer" | "basic";

export interface ConnectionConfig {
  id: string;
  name: string;
  /** Base URL of the Chroma server, e.g. http://localhost:8000 or https://api.trychroma.com */
  url: string;
  authType: AuthType;
  /** Token for x-chroma-token / bearer, or "user:password" for basic. */
  credentials?: string;
  /** Overrides the tenant reported by /auth/identity. */
  tenant?: string;
  /** Preferred database to open first. */
  database?: string;
  color?: string;
  /** Reject every write (records, collections, databases, migration targets). */
  readOnly?: boolean;
}

/** What the browser sees: secrets are never sent back. */
export interface ConnectionPublic extends Omit<ConnectionConfig, "credentials"> {
  hasCredentials: boolean;
}

export type ConnectionInput = Omit<ConnectionConfig, "id"> & { id?: string };

export interface ConnectionStatus {
  ok: boolean;
  apiVersion?: string;
  tenant?: string;
  databases?: string[];
  latencyMs?: number;
  error?: string;
}

export interface DatabaseInfo {
  id: string;
  name: string;
  tenant: string;
}

export type Space = "l2" | "cosine" | "ip";

export interface EmbeddingFunctionJson {
  type?: "known" | "legacy" | "unknown" | string;
  name?: string;
  config?: Record<string, unknown>;
}

export interface CollectionConfigurationJson {
  hnsw?: {
    space?: Space;
    ef_construction?: number;
    ef_search?: number;
    max_neighbors?: number;
    resize_factor?: number;
    sync_threshold?: number;
  } | null;
  spann?: Record<string, unknown> | null;
  embedding_function?: EmbeddingFunctionJson | null;
}

export type Metadata = Record<string, string | number | boolean | null | Array<string | number | boolean>>;

export interface CollectionInfo {
  id: string;
  name: string;
  tenant: string;
  database: string;
  metadata: Metadata | null;
  configuration: CollectionConfigurationJson;
  dimension?: number | null;
}

export interface CollectionDetail extends CollectionInfo {
  count: number;
  space: Space;
  embedding: EmbeddingResolution;
}

export interface CreateCollectionInput {
  name: string;
  metadata?: Metadata | null;
  space?: Space;
  efConstruction?: number;
  efSearch?: number;
  maxNeighbors?: number;
  /** Embedding profile to bind; its Chroma EF config is written to the collection. */
  profileId?: string;
}

export interface UpdateCollectionInput {
  name?: string;
  metadata?: Metadata | null;
  efSearch?: number;
  profileId?: string | null;
}

export interface RecordRow {
  id: string;
  document: string | null;
  metadata: Metadata | null;
  embedding?: number[] | null;
  uri?: string | null;
}

export interface GetRecordsInput {
  limit?: number;
  offset?: number;
  ids?: string[];
  where?: Record<string, unknown> | null;
  whereDocument?: Record<string, unknown> | null;
  includeEmbeddings?: boolean;
}

export interface GetRecordsResult {
  rows: RecordRow[];
  /** Total matching rows when known (unfiltered collections only). */
  total: number | null;
}

export interface WriteRecordsInput {
  mode: "add" | "update" | "upsert";
  records: Array<{
    id: string;
    document?: string | null;
    metadata?: Metadata | null;
    embedding?: number[] | null;
  }>;
  /** Compute embeddings for records that have a document but no embedding. */
  embedMissing?: boolean;
}

export interface DeleteRecordsInput {
  ids?: string[];
  where?: Record<string, unknown> | null;
  whereDocument?: Record<string, unknown> | null;
}

export interface SearchInput {
  text?: string;
  recordId?: string;
  embedding?: number[];
  nResults?: number;
  where?: Record<string, unknown> | null;
  whereDocument?: Record<string, unknown> | null;
  includeEmbeddings?: boolean;
}

export interface SearchHit extends RecordRow {
  distance: number;
  /** Space-aware similarity in roughly [0,1]; higher is closer. */
  similarity: number;
}

export interface SearchResult {
  hits: SearchHit[];
  space: Space;
  queryEmbedding: number[];
  tookMs: number;
  embedMs: number;
}

export interface ProjectionInput {
  limit?: number;
  where?: Record<string, unknown> | null;
  components?: number;
}

export interface ProjectionResult {
  ids: string[];
  documents: (string | null)[];
  metadatas: (Metadata | null)[];
  /** Row-major PCA scores, `components` values per row. */
  scores: number[][];
  explainedVariance: number[];
  dimension: number;
  total: number;
  sampled: number;
}

// ---- Embedding profiles -------------------------------------------------

export type EmbeddingProviderType = "default" | "openai" | "ollama";

export interface EmbeddingProfile {
  id: string;
  name: string;
  type: EmbeddingProviderType;
  model?: string;
  /** OpenAI-compatible base URL (…/v1) or Ollama URL. */
  baseUrl?: string;
  apiKey?: string;
  dimensions?: number;
}

export interface EmbeddingProfilePublic extends Omit<EmbeddingProfile, "apiKey"> {
  hasApiKey: boolean;
  builtin?: boolean;
}

export type EmbeddingProfileInput = Omit<EmbeddingProfile, "id"> & { id?: string };

export interface EmbeddingResolution {
  /** Profile used for text→vector in this tool, if any. */
  profileId: string | null;
  profileName: string | null;
  /** How it was chosen. */
  source: "binding" | "auto" | "ephemeral" | "none";
  /** EF declared in the collection's configuration. */
  declared: EmbeddingFunctionJson | null;
  hint?: string;
}

export interface AppSettings {
  hfEndpoint?: string;
}

// ---- Migration ----------------------------------------------------------

export interface CollectionRef {
  connectionId: string;
  database: string;
  collection: string;
}

export interface MigrationInput {
  source: CollectionRef;
  target: CollectionRef;
  /** create: target must not exist; append: upsert into existing (or create). */
  mode: "create" | "append";
  batchSize?: number;
}

export type MigrationState = "running" | "done" | "error" | "cancelled";

export interface MigrationJob {
  id: string;
  input: MigrationInput;
  state: MigrationState;
  copied: number;
  total: number;
  method: "fork" | "copy";
  startedAt: number;
  finishedAt?: number;
  error?: string;
}
