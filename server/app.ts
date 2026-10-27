import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { z, ZodError } from "zod";
import type { MigrationJob } from "../shared/types.ts";
import { ChromaHttpError } from "./chroma-rest.ts";
import { ConfigStore } from "./config-store.ts";
import { assertWritable, ConnectionPool } from "./context.ts";
import { MigrationManager } from "./migrations.ts";
import { collectionRoutes } from "./routes/collections.ts";
import { connectionRoutes } from "./routes/connections.ts";
import { profileRoutes, settingsRoutes } from "./routes/profiles.ts";

export interface Deps {
  store: ConfigStore;
  pool: ConnectionPool;
  migrations: MigrationManager;
}

const collectionRef = z.object({
  connectionId: z.string(),
  database: z.string().min(1),
  collection: z.string().trim().min(3, "集合名至少 3 个字符"),
});

export function createApp(store = new ConfigStore()) {
  const pool = new ConnectionPool(store);
  const deps: Deps = { store, pool, migrations: new MigrationManager(pool) };
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof ZodError) return c.json({ error: err.issues.map((i) => i.message).join("；") }, 400);
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof ChromaHttpError) {
      const status = err.status >= 400 && err.status < 600 ? err.status : 500;
      return c.json({ error: err.message, kind: err.kind }, status as 400);
    }
    console.error(err);
    return c.json({ error: err.message || "Internal error" }, 500);
  });

  const api = new Hono();
  api.get("/health", (c) => c.json({ ok: true }));
  api.route("/connections", connectionRoutes(deps));
  api.route("/connections/:cid/databases/:db/collections", collectionRoutes(deps));
  api.route("/embedding-profiles", profileRoutes(deps));
  api.route("/settings", settingsRoutes(deps));

  api.get("/migrations", (c) => c.json(deps.migrations.list()));
  api.post("/migrations", async (c) => {
    const input = z
      .object({
        source: collectionRef,
        target: collectionRef,
        mode: z.enum(["create", "append"]),
        batchSize: z.number().int().min(1).max(1000).optional(),
      })
      .parse(await c.req.json());
    assertWritable(store, input.target.connectionId);
    return c.json(deps.migrations.start(input), 201);
  });
  api.post("/migrations/:id/cancel", (c) => {
    deps.migrations.cancel(c.req.param("id"));
    return c.body(null, 204);
  });
  api.get("/migrations/:id/events", (c) => {
    const id = c.req.param("id");
    const job = deps.migrations.get(id);
    if (!job) throw new HTTPException(404, { message: "任务不存在" });
    return streamSSE(c, async (stream) => {
      // Serialize writes and keep the stream open until the terminal event is flushed.
      let chain = Promise.resolve();
      const send = (j: MigrationJob) => (chain = chain.then(() => stream.writeSSE({ data: JSON.stringify(j) })));
      await new Promise<void>((resolve) => {
        const done = () => {
          deps.migrations.events.off(id, onEvent);
          resolve();
        };
        const onEvent = (j: MigrationJob) => {
          send(j);
          if (j.state !== "running") chain.then(done);
        };
        // Subscribe before the snapshot so a job finishing in between is not missed.
        deps.migrations.events.on(id, onEvent);
        stream.onAbort(done);
        onEvent({ ...job });
      });
      await chain;
    });
  });

  app.route("/api", api);
  return { app, deps };
}
