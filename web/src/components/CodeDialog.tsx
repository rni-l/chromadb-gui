import type { CollectionDetail } from "@shared/types";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { type CodeLang, type CodeOp, generateCode } from "@/lib/codegen";
import { useConnections } from "@/lib/queries";
import { cn, copyText } from "@/lib/utils";
import { Button, Dialog } from "./ui";

const LANGS: Array<[CodeLang, string]> = [
  ["python", "Python"],
  ["js", "JavaScript"],
  ["curl", "curl"],
];

/** Equivalent client code for the current browse / search, so it can be pasted into an app. */
export function CodeDialog({ cid, detail, op, open, onOpenChange }: { cid: string; detail: CollectionDetail; op: CodeOp | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [lang, setLang] = useState<CodeLang>(() => {
    try {
      return (localStorage.getItem("codegen-lang") as CodeLang) || "python";
    } catch {
      return "python";
    }
  });
  const [copied, setCopied] = useState(false);
  const conn = useConnections().data?.find((c) => c.id === cid);
  if (!op || !conn) return null;

  const code = generateCode(lang, {
    url: conn.url,
    authType: conn.authType,
    tenant: detail.tenant,
    database: detail.database,
    collectionName: detail.name,
    collectionId: detail.id,
  }, op);

  const choose = (l: CodeLang) => {
    setLang(l);
    try {
      localStorage.setItem("codegen-lang", l);
    } catch {
      // per-viewer convenience only
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="复制为代码"
      description="与当前操作等价的客户端代码。凭据不会离开本机，代码里用占位符代替。"
      width="max-w-3xl"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="inline-flex gap-1 rounded-lg bg-sunken p-1">
            {LANGS.map(([l, label]) => (
              <button key={l} onClick={() => choose(l)} className={cn("h-7 rounded-md px-3 text-xs font-medium text-muted", lang === l && "bg-panel text-fg shadow-sm")}>
                {label}
              </button>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              copyText(code).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? <Check /> : <Copy />} {copied ? "已复制" : "复制"}
          </Button>
        </div>
        <pre className="max-h-[56vh] overflow-auto rounded-md bg-sunken p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-all">{code}</pre>
      </div>
    </Dialog>
  );
}
