import type { EmbeddingProfileInput, EmbeddingProfilePublic, EmbeddingProviderType } from "@shared/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Cpu, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/confirm";
import { Badge, Button, Dialog, ErrorBox, Field, Input, Select } from "@/components/ui";
import { PageHeader } from "@/layout/AppShell";
import { api } from "@/lib/api";
import { keys, useProfiles, useSettings } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface Preset {
  label: string;
  type: EmbeddingProviderType;
  baseUrl: string;
  model: string;
  needsKey: boolean;
}

const PRESETS: Preset[] = [
  { label: "OpenAI", type: "openai", baseUrl: "https://api.openai.com/v1", model: "text-embedding-3-small", needsKey: true },
  { label: "Ollama", type: "ollama", baseUrl: "http://localhost:11434", model: "nomic-embed-text", needsKey: false },
  { label: "Jina", type: "openai", baseUrl: "https://api.jina.ai/v1", model: "jina-embeddings-v3", needsKey: true },
  { label: "Mistral", type: "openai", baseUrl: "https://api.mistral.ai/v1", model: "mistral-embed", needsKey: true },
  { label: "Voyage AI", type: "openai", baseUrl: "https://api.voyageai.com/v1", model: "voyage-3.5", needsKey: true },
  { label: "硅基流动", type: "openai", baseUrl: "https://api.siliconflow.cn/v1", model: "BAAI/bge-m3", needsKey: true },
  { label: "阿里云百炼", type: "openai", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "text-embedding-v4", needsKey: true },
  { label: "智谱", type: "openai", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "embedding-3", needsKey: true },
];

const typeLabel: Record<EmbeddingProviderType, string> = { default: "本地 ONNX", openai: "OpenAI 兼容", ollama: "Ollama" };

export function SettingsPage() {
  const { data: profiles } = useProfiles();
  const [editing, setEditing] = useState<{ open: boolean; profile?: EmbeddingProfilePublic }>({ open: false });
  const qc = useQueryClient();

  const remove = useMutation({
    mutationFn: (id: string) => api.profiles.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.profiles }),
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="设置" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-8 p-6">
          <section>
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-[15px] font-semibold">Embedding 配置</h2>
                <p className="mt-0.5 text-xs text-muted">用于写入文档和语义检索。打开集合时会按集合声明的 embedding function 自动匹配（模型名 + 地址）。</p>
              </div>
              <Button variant="primary" onClick={() => setEditing({ open: true })}>
                <Plus /> 添加
              </Button>
            </div>
            <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-panel">
              {profiles?.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <Cpu className="size-4 shrink-0 text-subtle" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium">{p.name}</span>
                      <Badge>{typeLabel[p.type]}</Badge>
                      {p.builtin ? <Badge tone="accent">内置</Badge> : null}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-muted">
                      {p.model}
                      {p.baseUrl ? ` · ${p.baseUrl}` : ""}
                      {p.type === "openai" ? (p.hasApiKey ? " · 🔑 已保存" : " · 无 API Key") : ""}
                    </div>
                  </div>
                  {!p.builtin ? (
                    <>
                      <Button variant="ghost" size="icon-sm" onClick={() => setEditing({ open: true, profile: p })} aria-label="编辑">
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={async () => {
                          if (await confirm({ title: `删除「${p.name}」？`, body: "绑定了此配置的集合会恢复为自动匹配。", danger: true, confirmText: "删除" }))
                            remove.mutate(p.id);
                        }}
                        aria-label="删除"
                      >
                        <Trash2 />
                      </Button>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <HfMirror />
        </div>
      </div>
      <ProfileDialog open={editing.open} profile={editing.profile} onOpenChange={(open) => setEditing((e) => ({ ...e, open }))} />
    </div>
  );
}

function HfMirror() {
  const { data: settings } = useSettings();
  const [value, setValue] = useState("");
  const qc = useQueryClient();
  useEffect(() => setValue(settings?.hfEndpoint ?? ""), [settings]);
  const save = useMutation({
    mutationFn: (hfEndpoint: string) => api.settings.save({ hfEndpoint }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.settings });
      toast.success("已保存");
    },
  });
  return (
    <section>
      <h2 className="text-[15px] font-semibold">本地模型下载源</h2>
      <p className="mt-0.5 mb-3 text-xs text-muted">
        内置的 all-MiniLM-L6-v2（约 90MB）首次使用时从 HuggingFace 下载，缓存在 ~/.chromadb-gui/models。国内网络建议使用镜像。
      </p>
      <div className="flex gap-2">
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://huggingface.co（默认）" className="font-mono text-xs" />
        <Button variant="outline" onClick={() => setValue("https://hf-mirror.com")}>
          使用 hf-mirror
        </Button>
        <Button variant="primary" onClick={() => save.mutate(value.trim())} loading={save.isPending} disabled={value === (settings?.hfEndpoint ?? "")}>
          保存
        </Button>
      </div>
    </section>
  );
}

const blank = (): EmbeddingProfileInput => ({ name: "", type: "openai", model: "", baseUrl: "", apiKey: "" });

function ProfileDialog({ open, onOpenChange, profile }: { open: boolean; onOpenChange: (o: boolean) => void; profile?: EmbeddingProfilePublic }) {
  const [form, setForm] = useState<EmbeddingProfileInput>(blank);
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.profiles.test>> | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setForm(profile ? { ...profile, apiKey: "" } : blank());
  }, [open, profile]);

  const set = <K extends keyof EmbeddingProfileInput>(k: K, v: EmbeddingProfileInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setResult(null);
  };
  const applyPreset = (p: Preset) => {
    setForm((f) => ({ ...f, type: p.type, baseUrl: p.baseUrl, model: p.model, name: f.name || `${p.label} ${p.model}` }));
    setResult(null);
  };
  const payload = (): EmbeddingProfileInput => ({
    ...form,
    name: form.name.trim() || `${form.model}`,
    dimensions: form.dimensions || undefined,
  });

  const test = useMutation({ mutationFn: () => api.profiles.test(payload()), onSuccess: setResult });
  const save = useMutation({
    mutationFn: () => (profile ? api.profiles.update(profile.id, payload()) : api.profiles.create(payload())),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.profiles });
      qc.invalidateQueries({ queryKey: ["collection"] });
      onOpenChange(false);
      toast.success("已保存");
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={profile ? "编辑 Embedding 配置" : "添加 Embedding 配置"}
      description="API Key 仅保存在本机配置文件中"
      footer={
        <>
          <Button variant="outline" className="mr-auto" onClick={() => test.mutate()} loading={test.isPending} disabled={!form.model}>
            <Zap /> 测试
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!form.model}>
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!profile ? (
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted">快速选择</div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p)}
                  className={cn(
                    "h-7 rounded-md border border-border px-2.5 text-xs hover:border-accent hover:text-accent-text",
                    form.baseUrl === p.baseUrl && form.type === p.type && "border-accent bg-accent-soft text-accent-text",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="类型">
            <Select value={form.type} onChange={(e) => set("type", e.target.value as EmbeddingProviderType)}>
              <option value="openai">OpenAI / 兼容接口</option>
              <option value="ollama">Ollama</option>
            </Select>
          </Field>
          <Field label="名称">
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={form.model || "我的 embedding"} />
          </Field>
        </div>
        <Field label={form.type === "ollama" ? "Ollama 地址" : "Base URL"} hint={form.type === "openai" ? "以 /v1 结尾的 OpenAI 兼容地址，请求 {base}/embeddings" : undefined}>
          <Input value={form.baseUrl ?? ""} onChange={(e) => set("baseUrl", e.target.value)} className="font-mono text-xs" placeholder={form.type === "ollama" ? "http://localhost:11434" : "https://api.openai.com/v1"} />
        </Field>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Field label="模型" hint="需与集合写入时用的模型一致，自动匹配也靠它">
            <Input value={form.model ?? ""} onChange={(e) => set("model", e.target.value)} className="font-mono text-xs" />
          </Field>
          {form.type === "openai" ? (
            <Field label="维度（可选）" hint="仅支持的模型">
              <Input type="number" value={form.dimensions ?? ""} onChange={(e) => set("dimensions", e.target.value ? Number(e.target.value) : undefined)} />
            </Field>
          ) : null}
        </div>
        {form.type === "openai" ? (
          <Field label="API Key">
            <Input
              type="password"
              value={form.apiKey ?? ""}
              onChange={(e) => set("apiKey", e.target.value)}
              placeholder={profile?.hasApiKey ? "••••••（留空保持不变）" : "sk-…"}
              autoComplete="off"
            />
          </Field>
        ) : null}
        {result?.ok ? (
          <div className="flex items-start gap-2 rounded-md bg-success-soft px-3 py-2 text-xs text-success">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
            <div>
              可用 · {result.dimension} 维 · {result.latencyMs}ms
              <div className="mt-0.5 font-mono opacity-80">[{result.sample?.map((v) => v.toFixed(3)).join(", ")}, …]</div>
            </div>
          </div>
        ) : null}
        {result && !result.ok ? <ErrorBox error={result.error} /> : null}
        <ErrorBox error={test.error ?? save.error} />
      </div>
    </Dialog>
  );
}
