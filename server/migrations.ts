// Copy a collection to another name / database / connection, keeping the stored
// vectors (nothing is re-embedded). Same-database copies try Chroma's `fork`
// first, which is instant on Chroma Cloud but unsupported on local servers.

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { CollectionConfigurationJson, CollectionInfo, MigrationInput, MigrationJob } from "../shared/types.ts";
import { ChromaHttpError } from "./chroma-rest.ts";
import { type ConnectionPool, isCloud } from "./context.ts";

interface Running {
  job: MigrationJob;
  abort: AbortController;
}

export class MigrationManager {
  private jobs = new Map<string, Running>();
  readonly events = new EventEmitter();

  constructor(private pool: ConnectionPool) {
    this.events.setMaxListeners(100);
  }

  list(): MigrationJob[] {
    return [...this.jobs.values()].map((r) => r.job).sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string) {
    return this.jobs.get(id)?.job;
  }

  cancel(id: string) {
    const r = this.jobs.get(id);
    if (r?.job.state === "running") r.abort.abort();
  }

  start(input: MigrationInput): MigrationJob {
    const job: MigrationJob = { id: randomUUID(), input, state: "running", copied: 0, total: 0, method: "copy", startedAt: Date.now() };
    const running = { job, abort: new AbortController() };
    this.jobs.set(job.id, running);
    this.run(running).then(
      () => this.finish(job, "done"),
      (e) => this.finish(job, running.abort.signal.aborted ? "cancelled" : "error", (e as Error).message),
    );
    return job;
  }

  private emit(job: MigrationJob) {
    this.events.emit(job.id, { ...job });
  }

  private finish(job: MigrationJob, state: MigrationJob["state"], error?: string) {
    Object.assign(job, { state, finishedAt: Date.now(), error });
    this.emit(job);
  }

  private async run({ job, abort }: Running) {
    const { source, target, mode } = job.input;
    const batchSize = job.input.batchSize ?? 300;
    const src = await this.pool.get(source.connectionId);
    const dst = await this.pool.get(target.connectionId);
    const srcInfo = await src.rest.getCollection(src.tenant, source.database, source.collection);
    job.total = await src.rest.count(src.tenant, source.database, srcInfo.id);
    this.emit(job);

    const sameDb = source.connectionId === target.connectionId && source.database === target.database;
    if (sameDb && source.collection === target.collection) throw new Error("源和目标不能是同一个集合");

    if (sameDb && mode === "create") {
      try {
        await src.rest.forkCollection(src.tenant, source.database, srcInfo.id, target.collection);
        job.method = "fork";
        job.copied = job.total;
        return;
      } catch (e) {
        if (!(e instanceof ChromaHttpError) || /exist/i.test(e.message)) throw e;
        // fork unsupported (local Chroma) → fall back to copying
      }
    }

    let targetInfo: CollectionInfo | undefined;
    if (mode === "append") {
      targetInfo = await dst.rest.getCollection(dst.tenant, target.database, target.collection).catch((e) => {
        if (e instanceof ChromaHttpError && e.status === 404) return undefined;
        throw e;
      });
    }
    targetInfo ??= await dst.rest.createCollection(dst.tenant, target.database, {
      name: target.collection,
      metadata: srcInfo.metadata,
      configuration: copyableConfig(srcInfo.configuration, isCloud(dst.conn)),
    });

    for (let offset = 0; offset < job.total; offset += batchSize) {
      if (abort.signal.aborted) throw new Error("已取消");
      const page = await src.rest.get(
        src.tenant,
        source.database,
        srcInfo.id,
        { offset, limit: batchSize, include: ["embeddings", "documents", "metadatas", "uris"] },
        abort.signal,
      );
      if (!page.ids.length) break;
      await dst.rest.write(
        dst.tenant,
        target.database,
        targetInfo.id,
        "upsert",
        {
          ids: page.ids,
          embeddings: page.embeddings ?? undefined,
          documents: page.documents ?? undefined,
          metadatas: page.metadatas ?? undefined,
          uris: page.uris?.some((u) => u) ? page.uris : undefined,
        },
        abort.signal,
      );
      job.copied += page.ids.length;
      this.emit(job);
    }
  }
}

/** Index + EF settings that are valid to pass on create (drops server-derived fields). */
function copyableConfig(cfg: CollectionConfigurationJson, toCloud: boolean): CollectionConfigurationJson {
  const index = cfg.hnsw ?? cfg.spann ?? {};
  const pick = {
    space: index.space as "l2" | "cosine" | "ip" | undefined,
    ef_construction: index.ef_construction as number | undefined,
    ef_search: index.ef_search as number | undefined,
    max_neighbors: index.max_neighbors as number | undefined,
  };
  const out: CollectionConfigurationJson = toCloud ? { spann: pick } : { hnsw: pick };
  if (cfg.embedding_function?.type === "known") out.embedding_function = cfg.embedding_function;
  return out;
}
