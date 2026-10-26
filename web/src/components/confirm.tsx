import { useEffect, useState, type ReactNode } from "react";
import { Button, Dialog, Input } from "./ui";

interface ConfirmOptions {
  title: ReactNode;
  body?: ReactNode;
  confirmText?: string;
  danger?: boolean;
  /** Require typing this text (e.g. a collection name) before confirming. */
  typeToConfirm?: string;
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let show: ((p: Pending) => void) | null = null;

/** Imperative confirm: `if (await confirm({...})) doIt()`. Requires <ConfirmHost /> mounted once. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(window.confirm(String(options.title)));
    show({ ...options, resolve });
  });
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    show = (p) => {
      setTyped("");
      setPending(p);
    };
    return () => {
      show = null;
    };
  }, []);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  const blocked = Boolean(pending?.typeToConfirm && typed !== pending.typeToConfirm);

  return (
    <Dialog
      open={Boolean(pending)}
      onOpenChange={(o) => !o && close(false)}
      title={pending?.title}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            取消
          </Button>
          <Button variant={pending?.danger ? "danger" : "primary"} disabled={blocked} onClick={() => close(true)} autoFocus={!pending?.typeToConfirm}>
            {pending?.confirmText ?? "确定"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px] leading-relaxed text-muted">
        {pending?.body}
        {pending?.typeToConfirm ? (
          <div className="space-y-1.5">
            <div className="text-xs">
              输入 <code className="rounded bg-sunken px-1 font-mono text-fg">{pending.typeToConfirm}</code> 以确认
            </div>
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !blocked && close(true)}
            />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
