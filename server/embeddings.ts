// Embedding providers. The tool always computes vectors itself and passes them to
// Chroma explicitly, so any collection can be searched as long as we can map its
// declared embedding function onto one of the user's profiles.
//
// Adding a provider: implement an `Embedder` factory below, add the type to
// `EmbeddingProviderType`, and teach `toChromaEf` / `matchDeclared` about it.

import { join } from "node:path";
import type { AppSettings, EmbeddingFunctionJson, EmbeddingProfile, EmbeddingResolution } from "../shared/types.ts";
import { appHome, type ConfigStore } from "./config-store.ts";

export interface Embedder {
  generate(texts: string[]): Promise<number[][]>;
}

export const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

const BATCH = 64;

async function inBatches(texts: string[], fn: (chunk: string[]) => Promise<number[][]>) {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) out.push(...(await fn(texts.slice(i, i + BATCH))));
  return out;
}

async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause?.code;
    throw new Error(`请求 ${url} 失败：${cause ?? (e as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`Embedding 接口返回 ${res.status}：${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

function openAIEmbedder(p: EmbeddingProfile): Embedder {
  const base = (p.baseUrl || DEFAULT_OPENAI_BASE).replace(/\/+$/, "");
  if (!p.model) throw new Error(`Embedding 配置「${p.name}」缺少模型名`);
  return {
    generate: (texts) =>
      inBatches(texts, async (chunk) => {
        const res = await postJson<{ data: { index: number; embedding: number[] }[] }>(
          `${base}/embeddings`,
          { model: p.model, input: chunk, ...(p.dimensions ? { dimensions: p.dimensions } : {}) },
          p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {},
        );
        return [...res.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      }),
  };
}

export function normalizeOllamaUrl(url?: string) {
  return (url || DEFAULT_OLLAMA_URL).replace(/\/+$/, "").replace(/\/api\/embed(dings)?$/, "");
}

function ollamaEmbedder(p: EmbeddingProfile): Embedder {
  const base = normalizeOllamaUrl(p.baseUrl);
  if (!p.model) throw new Error(`Embedding 配置「${p.name}」缺少模型名`);
  return {
    generate: (texts) =>
      inBatches(texts, async (chunk) => {
        const res = await postJson<{ embeddings: number[][] }>(`${base}/api/embed`, { model: p.model, input: chunk });
        return res.embeddings;
      }),
  };
}

// The local ONNX model is expensive to load, so keep one instance per process.
let defaultEf: Promise<Embedder> | null = null;
let defaultEfHost: string | undefined;

function defaultEmbedder(settings: AppSettings): Embedder {
  const host = settings.hfEndpoint?.trim() || process.env.HF_ENDPOINT || undefined;
  if (!defaultEf || host !== defaultEfHost) {
    defaultEfHost = host;
    defaultEf = (async () => {
      const { env } = await import("@huggingface/transformers");
      env.cacheDir = join(appHome(), "models");
      if (host) env.remoteHost = host.endsWith("/") ? host : `${host}/`;
      const { DefaultEmbeddingFunction } = await import("@chroma-core/default-embed");
      return new DefaultEmbeddingFunction();
    })();
    defaultEf.catch(() => (defaultEf = null));
  }
  const ef = defaultEf;
  return {
    async generate(texts) {
      try {
        return await (await ef).generate(texts);
      } catch (e) {
        defaultEf = null;
        const msg = (e as Error).message;
        const hint = /fetch|timeout|ENOTFOUND|ECONN|UND_ERR/i.test(msg + String((e as { cause?: unknown }).cause))
          ? "（首次使用需从 HuggingFace 下载模型；网络不通时可在「设置」里配置镜像，如 https://hf-mirror.com）"
          : "";
        throw new Error(`本地默认模型调用失败：${msg}${hint}`);
      }
    },
  };
}

const cache = new Map<string, Embedder>();

export function createEmbedder(profile: EmbeddingProfile, settings: AppSettings): Embedder {
  if (profile.type === "default") return defaultEmbedder(settings);
  const key = JSON.stringify(profile);
  let e = cache.get(key);
  if (!e) {
    e = profile.type === "ollama" ? ollamaEmbedder(profile) : openAIEmbedder(profile);
    cache.set(key, e);
  }
  return e;
}

/** The EF declaration we write into a collection's configuration, readable by other Chroma clients. */
export function toChromaEf(p: EmbeddingProfile): EmbeddingFunctionJson {
  switch (p.type) {
    case "default":
      return { type: "known", name: "default", config: {} };
    case "ollama":
      return { type: "known", name: "ollama", config: { url: normalizeOllamaUrl(p.baseUrl), model_name: p.model } };
    case "openai": {
      const config: Record<string, unknown> = { api_key_env_var: "OPENAI_API_KEY", model_name: p.model };
      if (p.baseUrl && trimSlash(p.baseUrl) !== DEFAULT_OPENAI_BASE) config.api_base = trimSlash(p.baseUrl);
      if (p.dimensions) config.dimensions = p.dimensions;
      return { type: "known", name: "openai", config };
    }
  }
}

const trimSlash = (s: string) => s.replace(/\/+$/, "");

/** Map a collection's declared EF onto a stored profile, or an ad-hoc one when no secret is needed. */
function matchDeclared(declared: EmbeddingFunctionJson | null | undefined, profiles: EmbeddingProfile[]) {
  if (!declared?.name || declared.type === "legacy" || declared.type === "unknown") return null;
  const cfg = declared.config ?? {};
  const model = (cfg.model_name ?? cfg.model) as string | undefined;
  switch (declared.name) {
    case "default":
      return { profile: profiles.find((p) => p.type === "default")!, ephemeral: false };
    case "ollama": {
      const found = profiles.find((p) => p.type === "ollama" && p.model === model);
      if (found) return { profile: found, ephemeral: false };
      if (!model) return null;
      const ephemeral: EmbeddingProfile = {
        id: `ephemeral:ollama:${model}`,
        name: `Ollama ${model}（来自集合配置）`,
        type: "ollama",
        model,
        baseUrl: cfg.url as string | undefined,
      };
      return { profile: ephemeral, ephemeral: true };
    }
    case "openai": {
      const base = trimSlash((cfg.api_base as string) || DEFAULT_OPENAI_BASE);
      const found = profiles.find(
        (p) => p.type === "openai" && p.model === model && trimSlash(p.baseUrl || DEFAULT_OPENAI_BASE) === base,
      );
      return found ? { profile: found, ephemeral: false } : null;
    }
    default: {
      // Other hosted EFs (jina, voyageai, mistral, …) usually expose OpenAI-compatible
      // endpoints; a profile with the same model name is a good guess.
      const found = model ? profiles.find((p) => p.type === "openai" && p.model === model) : undefined;
      return found ? { profile: found, ephemeral: false } : null;
    }
  }
}

export function resolveEmbedding(
  store: ConfigStore,
  connectionId: string,
  collectionId: string,
  declared: EmbeddingFunctionJson | null | undefined,
): EmbeddingResolution & { profile: EmbeddingProfile | null } {
  const decl = declared ?? null;
  const boundId = store.getBinding(connectionId, collectionId);
  const bound = boundId ? store.getProfile(boundId) : undefined;
  if (bound) return { profile: bound, profileId: bound.id, profileName: bound.name, source: "binding", declared: decl };

  const match = matchDeclared(decl, store.allProfiles());
  if (match) {
    return {
      profile: match.profile,
      profileId: match.profile.id,
      profileName: match.profile.name,
      source: match.ephemeral ? "ephemeral" : "auto",
      declared: decl,
    };
  }
  const hint = decl?.name
    ? `集合声明的 embedding function 为「${decl.name}${decl.config?.model_name ? ` / ${decl.config.model_name}` : ""}」，未找到匹配的本地配置。请在集合「设置」中选择一个 Embedding 配置（模型需一致）。`
    : "集合未声明 embedding function。请在集合「设置」中选择用于文本检索的 Embedding 配置。";
  return { profile: null, profileId: null, profileName: null, source: "none", declared: decl, hint };
}
