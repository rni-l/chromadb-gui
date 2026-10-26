// Local, single-user persistence: ~/.chromadb-gui/config.json (mode 0600).
// Secrets (connection credentials, provider API keys) live only here and are
// masked before anything is sent to the browser.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AppSettings,
  ConnectionConfig,
  ConnectionInput,
  ConnectionPublic,
  EmbeddingProfile,
  EmbeddingProfileInput,
  EmbeddingProfilePublic,
} from "../shared/types.ts";

interface AppConfig {
  version: 1;
  connections: ConnectionConfig[];
  embeddingProfiles: EmbeddingProfile[];
  /** `${connectionId}/${collectionId}` → embedding profile id */
  bindings: Record<string, string>;
  settings: AppSettings;
}

export const DEFAULT_PROFILE: EmbeddingProfile = {
  id: "default",
  name: "Chroma 默认 (all-MiniLM-L6-v2, 本地)",
  type: "default",
  model: "Xenova/all-MiniLM-L6-v2",
};

export const appHome = () => process.env.CHROMADB_GUI_HOME ?? join(homedir(), ".chromadb-gui");

const emptyConfig = (): AppConfig => ({
  version: 1,
  connections: [],
  embeddingProfiles: [],
  bindings: {},
  settings: {},
});

export class ConfigStore {
  private cfg: AppConfig;
  private file: string;

  constructor(dir = appHome()) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = join(dir, "config.json");
    this.cfg = existsSync(this.file) ? { ...emptyConfig(), ...JSON.parse(readFileSync(this.file, "utf8")) } : emptyConfig();
  }

  private save() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.cfg, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  // ---- connections -----------------------------------------------------

  listConnections(): ConnectionPublic[] {
    return this.cfg.connections.map(maskConnection);
  }

  getConnection(id: string): ConnectionConfig | undefined {
    return this.cfg.connections.find((c) => c.id === id);
  }

  /** Upsert. An omitted/empty credentials field keeps the stored secret. */
  saveConnection(input: ConnectionInput): ConnectionPublic {
    const existing = input.id ? this.getConnection(input.id) : undefined;
    const conn: ConnectionConfig = {
      ...input,
      id: existing?.id ?? input.id ?? randomUUID(),
      credentials: input.credentials || existing?.credentials,
    };
    if (conn.authType === "none") delete conn.credentials;
    this.cfg.connections = existing
      ? this.cfg.connections.map((c) => (c.id === conn.id ? conn : c))
      : [...this.cfg.connections, conn];
    this.save();
    return maskConnection(conn);
  }

  deleteConnection(id: string) {
    this.cfg.connections = this.cfg.connections.filter((c) => c.id !== id);
    for (const key of Object.keys(this.cfg.bindings)) {
      if (key.startsWith(`${id}/`)) delete this.cfg.bindings[key];
    }
    this.save();
  }

  // ---- embedding profiles ----------------------------------------------

  listProfiles(): EmbeddingProfilePublic[] {
    return [{ ...maskProfile(DEFAULT_PROFILE), builtin: true }, ...this.cfg.embeddingProfiles.map(maskProfile)];
  }

  allProfiles(): EmbeddingProfile[] {
    return [DEFAULT_PROFILE, ...this.cfg.embeddingProfiles];
  }

  getProfile(id: string): EmbeddingProfile | undefined {
    return this.allProfiles().find((p) => p.id === id);
  }

  saveProfile(input: EmbeddingProfileInput): EmbeddingProfilePublic {
    if (input.id === DEFAULT_PROFILE.id) throw new Error("内置配置不可修改");
    const existing = input.id ? this.cfg.embeddingProfiles.find((p) => p.id === input.id) : undefined;
    const profile: EmbeddingProfile = {
      ...input,
      id: existing?.id ?? input.id ?? randomUUID(),
      apiKey: input.apiKey || existing?.apiKey,
    };
    this.cfg.embeddingProfiles = existing
      ? this.cfg.embeddingProfiles.map((p) => (p.id === profile.id ? profile : p))
      : [...this.cfg.embeddingProfiles, profile];
    this.save();
    return maskProfile(profile);
  }

  deleteProfile(id: string) {
    this.cfg.embeddingProfiles = this.cfg.embeddingProfiles.filter((p) => p.id !== id);
    for (const [key, value] of Object.entries(this.cfg.bindings)) {
      if (value === id) delete this.cfg.bindings[key];
    }
    this.save();
  }

  // ---- collection ↔ profile bindings -----------------------------------

  getBinding(connectionId: string, collectionId: string): string | undefined {
    return this.cfg.bindings[`${connectionId}/${collectionId}`];
  }

  setBinding(connectionId: string, collectionId: string, profileId: string | null) {
    const key = `${connectionId}/${collectionId}`;
    if (profileId) this.cfg.bindings[key] = profileId;
    else delete this.cfg.bindings[key];
    this.save();
  }

  // ---- settings --------------------------------------------------------

  getSettings(): AppSettings {
    return this.cfg.settings;
  }

  saveSettings(settings: AppSettings) {
    this.cfg.settings = { ...this.cfg.settings, ...settings };
    this.save();
    return this.cfg.settings;
  }
}

function maskConnection({ credentials, ...rest }: ConnectionConfig): ConnectionPublic {
  return { ...rest, hasCredentials: Boolean(credentials) };
}

function maskProfile({ apiKey, ...rest }: EmbeddingProfile): EmbeddingProfilePublic {
  return { ...rest, hasApiKey: Boolean(apiKey) };
}
