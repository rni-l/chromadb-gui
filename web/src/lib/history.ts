// Per-collection search history in localStorage: a per-browser convenience, so every
// read and write tolerates storage being unavailable.

import { useCallback, useState } from "react";
import type { Filters } from "@/components/FilterBar";

export type SearchMode = "text" | "record" | "vector";

export interface SearchDraft {
  mode: SearchMode;
  text: string;
  recordId: string;
  vector: string;
  n: number;
  filters: Filters;
}

export interface HistoryEntry extends SearchDraft {
  at: number;
  pinned?: boolean;
}

const MAX_UNPINNED = 20;
/** Pasted vectors can be huge; don't let one fill the storage quota. */
const MAX_VECTOR_CHARS = 20_000;

const sameQuery = (a: SearchDraft, b: SearchDraft) =>
  a.mode === b.mode &&
  a.n === b.n &&
  (a.mode === "text" ? a.text === b.text : a.mode === "record" ? a.recordId === b.recordId : a.vector === b.vector) &&
  JSON.stringify(a.filters) === JSON.stringify(b.filters);

function load(key: string): HistoryEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function useSearchHistory(cid: string, db: string, col: string) {
  const key = `search-history:${cid}/${db}/${col}`;
  const [entries, setEntries] = useState<HistoryEntry[]>(() => load(key));

  const update = useCallback(
    (fn: (prev: HistoryEntry[]) => HistoryEntry[]) =>
      setEntries((prev) => {
        const next = fn(prev);
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // quota exceeded or storage blocked: keep the in-memory list
        }
        return next;
      }),
    [key],
  );

  const add = useCallback(
    (draft: SearchDraft) => {
      if (draft.mode === "vector" && draft.vector.length > MAX_VECTOR_CHARS) return;
      update((prev) => {
        const old = prev.find((e) => sameQuery(e, draft));
        const rest = prev.filter((e) => e !== old);
        const entry: HistoryEntry = { ...draft, at: Date.now(), pinned: old?.pinned };
        let unpinned = 0;
        return [entry, ...rest].filter((e) => e.pinned || ++unpinned <= MAX_UNPINNED);
      });
    },
    [update],
  );

  const togglePin = (at: number) => update((prev) => prev.map((e) => (e.at === at ? { ...e, pinned: !e.pinned } : e)));
  const remove = (at: number) => update((prev) => prev.filter((e) => e.at !== at));
  const clear = () => update((prev) => prev.filter((e) => e.pinned));

  // Pinned first, then most recent.
  const sorted = [...entries].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.at - a.at);
  return { entries: sorted, add, togglePin, remove, clear };
}
