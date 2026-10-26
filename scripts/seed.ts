// Seed a local Chroma with sample collections for trying the GUI.
//   pnpm seed                         # http://localhost:8000
//   CHROMA_URL=http://localhost:8010 pnpm seed
// Uses the built-in local model; set HF_ENDPOINT=https://hf-mirror.com if HuggingFace is unreachable.

import { ChromaRest } from "../server/chroma-rest.ts";
import { DEFAULT_PROFILE } from "../server/config-store.ts";
import { createEmbedder, toChromaEf } from "../server/embeddings.ts";
import type { Metadata } from "../shared/types.ts";

const url = process.env.CHROMA_URL ?? "http://localhost:8000";
const rest = new ChromaRest({ url, authType: "none" });
const tenant = (await rest.identity()).tenant;
const database = "default_database";
const embedder = createEmbedder(DEFAULT_PROFILE, {});

const topics: Record<string, { subjects: string[]; verbs: string[]; objects: string[] }> = {
  science: {
    subjects: ["Astronomers", "A new telescope", "Physicists", "The research team", "Biologists"],
    verbs: ["discovered", "measured", "observed", "mapped", "simulated"],
    objects: ["a distant exoplanet", "gravitational waves", "dark matter halos", "a rare protein fold", "quantum entanglement in crystals"],
  },
  sports: {
    subjects: ["The home team", "The striker", "The veteran goalkeeper", "The coach", "The underdogs"],
    verbs: ["won", "lost", "dominated", "clinched", "fought through"],
    objects: ["the championship final", "a penalty shootout", "the season opener", "an overtime thriller", "the derby match"],
  },
  cooking: {
    subjects: ["This recipe", "The chef", "Grandma's method", "A slow braise", "The bakery"],
    verbs: ["combines", "caramelizes", "roasts", "ferments", "folds"],
    objects: ["garlic and fresh basil", "sourdough with rye flour", "short ribs in red wine", "kimchi with napa cabbage", "butter into flaky pastry"],
  },
  finance: {
    subjects: ["The central bank", "Tech stocks", "Bond yields", "The startup", "Investors"],
    verbs: ["raised", "rallied after", "fell on", "priced in", "reacted to"],
    objects: ["interest rates by 25 basis points", "strong quarterly earnings", "inflation data", "a Series B funding round", "recession fears"],
  },
  travel: {
    subjects: ["The night train", "Our itinerary", "The coastal town", "Backpackers", "The mountain lodge"],
    verbs: ["winds through", "includes", "offers", "explore", "overlooks"],
    objects: ["the Swiss Alps", "hidden beaches in Portugal", "street food markets in Bangkok", "temples near Kyoto", "a glacier lake at sunrise"],
  },
};

function* articles() {
  let n = 0;
  for (const [topic, t] of Object.entries(topics)) {
    for (const s of t.subjects) for (const v of t.verbs) for (const o of t.objects.slice(0, 3)) {
      yield {
        id: `${topic}-${String(++n).padStart(4, "0")}`,
        document: `${s} ${v} ${o}.`,
        metadata: { topic, year: 2018 + (n % 8), words: `${s} ${v} ${o}`.split(" ").length, featured: n % 7 === 0 } as Metadata,
      };
    }
  }
}

async function seed(name: string, space: "cosine" | "l2", records: { id: string; document: string; metadata: Metadata }[]) {
  await rest.deleteCollection(tenant, database, name).catch(() => {});
  const col = await rest.createCollection(tenant, database, {
    name,
    metadata: { description: `Sample data (${records.length} records)` },
    configuration: { hnsw: { space }, embedding_function: toChromaEf(DEFAULT_PROFILE) },
  });
  for (let i = 0; i < records.length; i += 100) {
    const chunk = records.slice(i, i + 100);
    const embeddings = await embedder.generate(chunk.map((r) => r.document));
    await rest.write(tenant, database, col.id, "add", {
      ids: chunk.map((r) => r.id),
      documents: chunk.map((r) => r.document),
      metadatas: chunk.map((r) => r.metadata),
      embeddings,
    });
  }
  console.log(`✓ ${name}: ${records.length} records`);
}

const list = [...articles()];
await seed("sample_articles", "cosine", list);

const products = ["wireless earbuds", "mechanical keyboard", "espresso machine", "trail running shoes", "yoga mat", "air fryer", "4K monitor", "camping tent", "electric toothbrush", "standing desk"];
const adjectives = ["compact", "premium", "budget", "ergonomic", "waterproof", "lightweight"];
await seed(
  "sample_products",
  "l2",
  products.flatMap((p, i) =>
    adjectives.map((a, j) => ({
      id: `p${i}-${j}`,
      document: `A ${a} ${p} with great reviews.`,
      metadata: { category: i < 3 ? "electronics" : i < 6 ? "outdoor" : "home", price: Math.round((20 + i * 37 + j * 11) * 100) / 100, in_stock: (i + j) % 3 !== 0 },
    })),
  ),
);
