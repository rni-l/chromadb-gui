import type { AuthType, ConnectionInput, ConnectionPublic, ConnectionStatus } from "@shared/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { keys } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Button, Dialog, ErrorBox, Field, Input, Select } from "./ui";

const COLORS = ["#ea580c", "#2563eb", "#16a34a", "#9333ea", "#db2777", "#0891b2", "#ca8a04", "#64748b"];

const PRESETS = {
  local: { label: "本地 / 自建", url: "http://localhost:8000", authType: "none" as AuthType },
  cloud: { label: "Chroma Cloud", url: "https://api.trychroma.com", authType: "x-chroma-token" as AuthType },
};

const blank = (): ConnectionInput => ({ name: "", url: PRESETS.local.url, authType: "none", credentials: "", tenant: "", database: "", color: COLORS[0] });

export function ConnectionDialog({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (o: boolean) => void; editing?: ConnectionPublic }) {
  const [form, setForm] = useState<ConnectionInput>(blank);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setForm(editing ? { ...editing, credentials: "", tenant: editing.tenant ?? "", database: editing.database ?? "" } : blank());
  }, [open, editing]);

  const set = <K extends keyof ConnectionInput>(k: K, v: ConnectionInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setStatus(null);
  };
  const payload = (): ConnectionInput => ({
    ...form,
    name: form.name.trim() || hostOf(form.url),
    tenant: form.tenant?.trim() || undefined,
    database: form.database?.trim() || undefined,
  });

  const test = useMutation({ mutationFn: () => api.connections.test(payload()), onSuccess: setStatus });
  const save = useMutation({
    mutationFn: () => (editing ? api.connections.update(editing.id, payload()) : api.connections.create(payload())),
    onSuccess: (conn) => {
      qc.invalidateQueries({ queryKey: keys.connections });
      qc.invalidateQueries({ queryKey: keys.databases(conn.id) });
      onOpenChange(false);
      toast.success(editing ? "连接已更新" : "连接已添加");
      if (!editing) navigate(`/c/${conn.id}`);
    },
  });

  const preset = form.url.includes("trychroma.com") ? "cloud" : "local";
  const needsCred = form.authType !== "none";

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "编辑连接" : "新建连接"}
      description="连接信息与凭据仅保存在本机 ~/.chromadb-gui/config.json"
      footer={
        <>
          <Button variant="outline" onClick={() => test.mutate()} loading={test.isPending} className="mr-auto">
            <Zap /> 测试连接
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!form.url}>
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-sunken p-1">
          {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((k) => (
            <button
              key={k}
              onClick={() => setForm((f) => ({ ...f, url: PRESETS[k].url, authType: PRESETS[k].authType }))}
              className={cn("h-7 rounded-md text-xs font-medium text-muted", preset === k && "bg-panel text-fg shadow-sm")}
            >
              {PRESETS[k].label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="名称">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={hostOf(form.url) || "我的 Chroma"} autoFocus />
          </Field>
          <Field label="颜色">
            <div className="flex h-8 items-center gap-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => set("color", c)}
                  className={cn("size-4 rounded-full ring-offset-2 ring-offset-[var(--panel)]", form.color === c && "ring-2 ring-[var(--fg-subtle)]")}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </Field>
        </div>

        <Field label="服务地址" hint="Chroma 1.x 服务的根地址（不含 /api/v2）">
          <Input value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="http://localhost:8000" className="font-mono text-xs" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="认证方式">
            <Select value={form.authType} onChange={(e) => set("authType", e.target.value as AuthType)}>
              <option value="none">无</option>
              <option value="x-chroma-token">Token（X-Chroma-Token）</option>
              <option value="bearer">Token（Authorization: Bearer）</option>
              <option value="basic">Basic（用户名:密码）</option>
            </Select>
          </Field>
          {needsCred ? (
            <Field label={form.authType === "basic" ? "用户名:密码" : "Token / API Key"}>
              <Input
                type="password"
                value={form.credentials ?? ""}
                onChange={(e) => set("credentials", e.target.value)}
                placeholder={editing?.hasCredentials ? "••••••（留空保持不变）" : ""}
                autoComplete="off"
              />
            </Field>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tenant（可选）" hint="留空则从 /auth/identity 自动获取">
            <Input value={form.tenant ?? ""} onChange={(e) => set("tenant", e.target.value)} placeholder="default_tenant" />
          </Field>
          <Field label="默认数据库（可选）">
            <Input value={form.database ?? ""} onChange={(e) => set("database", e.target.value)} placeholder="default_database" />
          </Field>
        </div>

        <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-3 py-2.5">
          <input type="checkbox" checked={Boolean(form.readOnly)} onChange={(e) => set("readOnly", e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
          <span>
            <span className="block text-xs font-medium">只读连接</span>
            <span className="block text-[11px] leading-snug text-subtle">禁止对这个连接写入、修改和删除，也不能作为复制 / 迁移的目标。适合浏览生产库。</span>
          </span>
        </label>

        {status?.ok ? (
          <div className="flex items-start gap-2 rounded-md bg-success-soft px-3 py-2 text-xs text-success">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
            <div>
              连接成功 · {status.latencyMs}ms · API {status.apiVersion} · tenant <b>{status.tenant}</b>
              <div className="mt-0.5 opacity-80">数据库：{status.databases?.join("、") || "（无）"}</div>
            </div>
          </div>
        ) : null}
        {status && !status.ok ? <ErrorBox error={status.error} /> : null}
        <ErrorBox error={test.error ?? save.error} />
      </div>
    </Dialog>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
