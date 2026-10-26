import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Metadata } from "@shared/types";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const fmtNum = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));

export function fmtScalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(fmtScalar).join(", ")}]`;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Metadata keys across rows, most frequent first. */
export function metadataKeys(rows: Array<{ metadata: Metadata | null }>, max = 12): string[] {
  const freq = new Map<string, number>();
  for (const r of rows) for (const k of Object.keys(r.metadata ?? {})) freq.set(k, (freq.get(k) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k);
}

export function parseJsonObject(text: string, label: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t) return null;
  let v: unknown;
  try {
    v = JSON.parse(t);
  } catch (e) {
    throw new Error(`${label} 不是合法 JSON：${(e as Error).message}`);
  }
  if (v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw new Error(`${label} 必须是 JSON 对象`);
  return v as Record<string, unknown>;
}

export function l2norm(v: number[]) {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

export async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

export const spaceLabel = { cosine: "余弦 (cosine)", l2: "欧氏距离² (l2)", ip: "内积 (ip)" } as const;
