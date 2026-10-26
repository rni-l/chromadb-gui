import { Braces, ListFilter, Plus, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { cn, parseJsonObject } from "@/lib/utils";
import { JsonEditor } from "./JsonEditor";
import { Button, ErrorBox, Input, Select } from "./ui";

export interface Filters {
  where: Record<string, unknown> | null;
  whereDocument: Record<string, unknown> | null;
}

export const emptyFilters: Filters = { where: null, whereDocument: null };
export const hasFilters = (f: Filters) => Boolean(f.where || f.whereDocument);

const OPS = [
  ["$eq", "="],
  ["$ne", "≠"],
  ["$gt", ">"],
  ["$gte", "≥"],
  ["$lt", "<"],
  ["$lte", "≤"],
  ["$in", "in"],
  ["$nin", "not in"],
] as const;
type Op = (typeof OPS)[number][0];

interface Cond {
  key: string;
  op: Op;
  value: string;
}

/** "42" → 42, "true" → true, "\"42\"" → "42", otherwise the raw string. */
function parseValue(raw: string): string | number | boolean {
  const t = raw.trim();
  if (/^".*"$/.test(t)) return t.slice(1, -1);
  if (t === "true" || t === "false") return t === "true";
  if (t !== "" && !Number.isNaN(Number(t))) return Number(t);
  return t;
}

function buildWhere(conds: Cond[]): Record<string, unknown> | null {
  const parts = conds
    .filter((c) => c.key.trim() && c.value.trim())
    .map((c) => ({
      [c.key.trim()]: { [c.op]: c.op === "$in" || c.op === "$nin" ? c.value.split(",").map(parseValue) : parseValue(c.value) },
    }));
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : { $and: parts };
}

/**
 * Metadata conditions + document substring, with a raw JSON mode for anything the
 * builder can't express ($or, $regex, nested logic…). Applies on submit only.
 */
export function FilterBar({ value, onChange, metadataKeys = [], className }: { value: Filters; onChange: (f: Filters) => void; metadataKeys?: string[]; className?: string }) {
  const [mode, setMode] = useState<"builder" | "json">("builder");
  const [doc, setDoc] = useState("");
  const [conds, setConds] = useState<Cond[]>([]);
  const [whereJson, setWhereJson] = useState("");
  const [docJson, setDocJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listId = useId();

  // Reset local state when filters are cleared from outside.
  useEffect(() => {
    if (!hasFilters(value)) {
      setDoc("");
      setConds([]);
      setWhereJson("");
      setDocJson("");
    }
  }, [value]);

  const apply = () => {
    try {
      setError(null);
      if (mode === "builder") {
        onChange({ where: buildWhere(conds), whereDocument: doc.trim() ? { $contains: doc.trim() } : null });
      } else {
        onChange({ where: parseJsonObject(whereJson, "where"), whereDocument: parseJsonObject(docJson, "where_document") });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const switchMode = () => {
    if (mode === "builder") {
      const w = buildWhere(conds);
      setWhereJson(w ? JSON.stringify(w, null, 2) : "");
      setDocJson(doc.trim() ? JSON.stringify({ $contains: doc.trim() }, null, 2) : "");
    }
    setMode(mode === "builder" ? "json" : "builder");
  };

  const active = hasFilters(value);

  return (
    <div className={cn("space-y-2", className)}>
      {mode === "builder" ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <ListFilter className="pointer-events-none absolute top-2 left-2.5 size-4 text-subtle" />
            <Input
              value={doc}
              onChange={(e) => setDoc(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && apply()}
              placeholder="文档包含…（where_document $contains）"
              className="pl-8"
            />
          </div>
          <Button variant="outline" onClick={() => setConds([...conds, { key: metadataKeys[0] ?? "", op: "$eq", value: "" }])}>
            <Plus /> Metadata 条件
          </Button>
          <Button variant="ghost" onClick={switchMode} title="切换到 JSON 模式">
            <Braces /> JSON
          </Button>
          <Button variant="primary" onClick={apply}>
            应用
          </Button>
          {active ? (
            <Button variant="ghost" onClick={() => onChange(emptyFilters)}>
              清除
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <div className="mb-1 text-[11px] font-medium text-muted">where（metadata）</div>
              <JsonEditor value={whereJson} onChange={setWhereJson} minHeight="72px" maxHeight="200px" placeholder='{ "$and": [{ "source": "web" }, { "page": { "$gt": 3 } }] }' />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium text-muted">where_document</div>
              <JsonEditor value={docJson} onChange={setDocJson} minHeight="72px" maxHeight="200px" placeholder='{ "$contains": "chroma" }' />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={switchMode}>
              <ListFilter /> 返回构建器
            </Button>
            <div className="flex-1" />
            {active ? (
              <Button variant="ghost" onClick={() => onChange(emptyFilters)}>
                清除
              </Button>
            ) : null}
            <Button variant="primary" onClick={apply}>
              应用
            </Button>
          </div>
        </div>
      )}

      {mode === "builder" && conds.length ? (
        <div className="space-y-1.5">
          <datalist id={listId}>
            {metadataKeys.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
          {conds.map((c, i) => {
            const update = (patch: Partial<Cond>) => setConds(conds.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="w-8 text-right text-[11px] text-subtle">{i === 0 ? "where" : "and"}</span>
                <Input list={listId} value={c.key} onChange={(e) => update({ key: e.target.value })} placeholder="key" className="w-40 font-mono text-xs" />
                <Select value={c.op} onChange={(e) => update({ op: e.target.value as Op })} className="w-24">
                  {OPS.map(([op, label]) => (
                    <option key={op} value={op}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Input
                  value={c.value}
                  onChange={(e) => update({ value: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && apply()}
                  placeholder={c.op === "$in" || c.op === "$nin" ? "a, b, 3" : '值（数字/true/"字符串"）'}
                  className="w-56 font-mono text-xs"
                />
                <Button variant="ghost" size="icon-sm" onClick={() => setConds(conds.filter((_, j) => j !== i))} aria-label="移除条件">
                  <X />
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}
      {error ? <ErrorBox error={error} /> : null}
    </div>
  );
}
