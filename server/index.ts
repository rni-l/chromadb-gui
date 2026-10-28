import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";

const port = Number(process.env.PORT ?? 4580);
// Local single-user tool: bind to loopback only unless explicitly overridden.
const hostname = process.env.HOST ?? "127.0.0.1";

// Desktop sidecar: the parent holds our stdin open, so EOF means the app is gone
// (including a crash) and we should not linger as an orphan.
if (process.env.CHROMADB_GUI_PARENT_STDIN === "1") {
  process.stdin.on("end", () => process.exit(0));
  process.stdin.resume();
}

const { app } = createApp();

// WEB_DIST: the desktop bundle ships the server and web assets in different places.
const dist = process.env.WEB_DIST ?? fileURLToPath(new URL("../web/dist", import.meta.url));
if (process.env.NODE_ENV === "production") {
  if (!existsSync(dist)) {
    console.error("web/dist 不存在，请先运行 pnpm build");
    process.exit(1);
  }
  app.use("/*", serveStatic({ root: dist }));
  // SPA fallback
  app.get("*", serveStatic({ root: dist, path: "index.html" }));
}

// overrideGlobalObjects: node-server otherwise swaps global Request/Response for its
// own classes, which breaks `instanceof Response` checks in @huggingface/transformers.
serve({ fetch: app.fetch, port, hostname, overrideGlobalObjects: false }, (info) => {
  console.log(`ChromaDB GUI server listening on http://${info.address}:${info.port}`);
});
