import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { ConnectionConfig, ConnectionStatus, DatabaseInfo } from "../../shared/types.ts";
import { assertWritable, connect } from "../context.ts";
import type { Deps } from "../app.ts";

const connectionInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "名称不能为空"),
  url: z.string().trim().url("URL 格式不正确"),
  authType: z.enum(["none", "x-chroma-token", "bearer", "basic"]),
  credentials: z.string().optional(),
  tenant: z.string().trim().optional(),
  database: z.string().trim().optional(),
  color: z.string().optional(),
  readOnly: z.boolean().optional(),
});

async function probe(conn: ConnectionConfig): Promise<ConnectionStatus> {
  const t = Date.now();
  try {
    const { rest, tenant } = await connect(conn);
    const [apiVersion, dbs] = await Promise.all([rest.version(), rest.listDatabases(tenant)]);
    return { ok: true, apiVersion, tenant, databases: dbs.map((d) => d.name), latencyMs: Date.now() - t };
  } catch (e) {
    return { ok: false, error: (e as Error).message, latencyMs: Date.now() - t };
  }
}

export function connectionRoutes({ store, pool }: Deps) {
  const r = new Hono();

  r.get("/", (c) => c.json(store.listConnections()));

  r.post("/", async (c) => {
    const input = connectionInput.parse(await c.req.json());
    const saved = store.saveConnection({ ...input, id: undefined });
    return c.json(saved, 201);
  });

  r.put("/:id", async (c) => {
    const id = c.req.param("id");
    if (!store.getConnection(id)) throw new HTTPException(404, { message: "连接不存在" });
    const input = connectionInput.parse(await c.req.json());
    pool.invalidate(id);
    return c.json(store.saveConnection({ ...input, id }));
  });

  r.delete("/:id", (c) => {
    const id = c.req.param("id");
    pool.invalidate(id);
    store.deleteConnection(id);
    return c.body(null, 204);
  });

  /** Test an unsaved (or edited) connection; blank credentials fall back to the stored ones. */
  r.post("/test", async (c) => {
    const input = connectionInput.parse(await c.req.json());
    const stored = input.id ? store.getConnection(input.id) : undefined;
    return c.json(await probe({ ...input, id: input.id ?? "test", credentials: input.credentials || stored?.credentials }));
  });

  r.get("/:id/status", async (c) => {
    const conn = store.getConnection(c.req.param("id"));
    if (!conn) throw new HTTPException(404, { message: "连接不存在" });
    return c.json(await probe(conn));
  });

  r.get("/:id/databases", async (c) => {
    const { rest, tenant } = await pool.get(c.req.param("id"));
    const dbs: DatabaseInfo[] = await rest.listDatabases(tenant);
    return c.json(dbs);
  });

  r.post("/:id/databases", async (c) => {
    const { name } = z.object({ name: z.string().trim().min(1) }).parse(await c.req.json());
    assertWritable(store, c.req.param("id"));
    const { rest, tenant } = await pool.get(c.req.param("id"));
    await rest.createDatabase(tenant, name);
    return c.json({ name }, 201);
  });

  r.delete("/:id/databases/:db", async (c) => {
    assertWritable(store, c.req.param("id"));
    const { rest, tenant } = await pool.get(c.req.param("id"));
    await rest.deleteDatabase(tenant, c.req.param("db"));
    return c.body(null, 204);
  });

  return r;
}
