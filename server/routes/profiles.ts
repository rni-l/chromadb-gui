import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Deps } from "../app.ts";
import { createEmbedder } from "../embeddings.ts";

const profileInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "名称不能为空"),
  type: z.enum(["default", "openai", "ollama"]),
  model: z.string().trim().optional(),
  baseUrl: z.string().trim().optional(),
  apiKey: z.string().optional(),
  dimensions: z.number().int().positive().optional(),
});

export function profileRoutes({ store }: Deps) {
  const r = new Hono();

  r.get("/", (c) => c.json(store.listProfiles()));

  r.post("/", async (c) => {
    const input = profileInput.parse(await c.req.json());
    return c.json(store.saveProfile({ ...input, id: undefined }), 201);
  });

  r.put("/:id", async (c) => {
    const input = profileInput.parse(await c.req.json());
    return c.json(store.saveProfile({ ...input, id: c.req.param("id") }));
  });

  r.delete("/:id", (c) => {
    if (c.req.param("id") === "default") throw new HTTPException(400, { message: "内置配置不可删除" });
    store.deleteProfile(c.req.param("id"));
    return c.body(null, 204);
  });

  /** Embed a sample sentence; blank apiKey falls back to the stored key. */
  r.post("/test", async (c) => {
    const input = profileInput.parse(await c.req.json());
    const stored = input.id ? store.getProfile(input.id) : undefined;
    const t = Date.now();
    try {
      const [v] = await createEmbedder(
        { ...input, id: input.id ?? "test", apiKey: input.apiKey || stored?.apiKey },
        store.getSettings(),
      ).generate(["ChromaDB GUI embedding test"]);
      return c.json({ ok: true, dimension: v.length, latencyMs: Date.now() - t, sample: v.slice(0, 8) });
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message, latencyMs: Date.now() - t });
    }
  });

  return r;
}

export function settingsRoutes({ store }: Deps) {
  const r = new Hono();
  r.get("/", (c) => c.json(store.getSettings()));
  r.put("/", async (c) => {
    const input = z.object({ hfEndpoint: z.string().trim().optional() }).parse(await c.req.json());
    return c.json(store.saveSettings(input));
  });
  return r;
}
