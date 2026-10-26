/// <reference lib="webworker" />
import { UMAP } from "umap-js";

export interface UmapRequest {
  data: number[][];
  nNeighbors: number;
  minDist: number;
}

export type UmapMessage =
  | { type: "progress"; epoch: number; total: number }
  | { type: "done"; embedding: number[][] }
  | { type: "error"; message: string };

self.onmessage = (e: MessageEvent<UmapRequest>) => {
  const { data, nNeighbors, minDist } = e.data;
  const post = (m: UmapMessage) => self.postMessage(m);
  try {
    if (data.length < 4) {
      post({ type: "done", embedding: data.map((r) => [r[0] ?? 0, r[1] ?? 0]) });
      return;
    }
    const umap = new UMAP({ nComponents: 2, nNeighbors: Math.min(nNeighbors, data.length - 1), minDist });
    const total = umap.initializeFit(data);
    for (let i = 0; i < total; i++) {
      umap.step();
      if (i % 10 === 0) post({ type: "progress", epoch: i, total });
    }
    post({ type: "done", embedding: umap.getEmbedding() });
  } catch (err) {
    post({ type: "error", message: (err as Error).message });
  }
};
