import { HTTPException } from "hono/http-exception";
import type { CollectionInfo, ConnectionConfig, Space } from "../shared/types.ts";
import { ChromaRest } from "./chroma-rest.ts";
import type { ConfigStore } from "./config-store.ts";

export interface Connected {
  conn: ConnectionConfig;
  rest: ChromaRest;
  tenant: string;
}

export const isCloud = (conn: Pick<ConnectionConfig, "url">) => /trychroma\.com/i.test(conn.url);

/** Caches a REST client and resolved tenant per saved connection. */
export class ConnectionPool {
  private cache = new Map<string, Promise<Connected>>();

  constructor(private store: ConfigStore) {}

  get(id: string): Promise<Connected> {
    let p = this.cache.get(id);
    if (!p) {
      const conn = this.store.getConnection(id);
      if (!conn) throw new HTTPException(404, { message: `连接不存在：${id}` });
      p = connect(conn);
      p.catch(() => this.cache.delete(id));
      this.cache.set(id, p);
    }
    return p;
  }

  invalidate(id: string) {
    this.cache.delete(id);
  }
}

export async function connect(conn: ConnectionConfig): Promise<Connected> {
  const rest = new ChromaRest(conn);
  const tenant = conn.tenant || (await rest.identity()).tenant || "default_tenant";
  return { conn, rest, tenant };
}

export function spaceOf(info: Pick<CollectionInfo, "configuration">): Space {
  return info.configuration.hnsw?.space ?? (info.configuration.spann?.space as Space | undefined) ?? "l2";
}

/** Space-aware similarity; higher is closer. */
export function similarity(space: Space, distance: number) {
  if (space === "l2") return 1 / (1 + distance);
  // cosine distance = 1 - cos; ip distance = 1 - dot
  return 1 - distance;
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}
