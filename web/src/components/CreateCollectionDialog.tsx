import type { Space } from "@shared/types";
import { useMutation } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useInvalidateCollection, useProfiles } from "@/lib/queries";
import { cn, parseJsonObject } from "@/lib/utils";
import { JsonEditor } from "./JsonEditor";
import { Button, Dialog, ErrorBox, Field, Input, Select } from "./ui";

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,510}[a-zA-Z0-9]$/;

export function CreateCollectionDialog({ cid, db, open, onOpenChange }: { cid: string; db: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: profiles } = useProfiles();
  const [name, setName] = useState("");
  const [space, setSpace] = useState<Space>("cosine");
  const [profileId, setProfileId] = useState("default");
  const [metadata, setMetadata] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [efConstruction, setEfConstruction] = useState("100");
  const [efSearch, setEfSearch] = useState("100");
  const [maxNeighbors, setMaxNeighbors] = useState("16");
  const invalidate = useInvalidateCollection();
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      setName("");
      setMetadata("");
      setAdvanced(false);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () =>
      api.collections.create(cid, db, {
        name: name.trim(),
        space,
        profileId: profileId || undefined,
        metadata: parseJsonObject(metadata, "Metadata") as never,
        ...(advanced
          ? { efConstruction: Number(efConstruction) || undefined, efSearch: Number(efSearch) || undefined, maxNeighbors: Number(maxNeighbors) || undefined }
          : {}),
      }),
    onSuccess: (c) => {
      invalidate(cid, db);
      onOpenChange(false);
      toast.success(`集合「${c.name}」已创建`);
      navigate(`/c/${cid}/${encodeURIComponent(db)}/${encodeURIComponent(c.name)}`);
    },
  });

  const nameError = name && !NAME_RE.test(name.trim()) ? "3–512 个字符，仅字母数字和 . _ -，首尾须为字母或数字" : null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="新建集合"
      description={`数据库：${db}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="primary" onClick={() => create.mutate()} loading={create.isPending} disabled={!name || Boolean(nameError)}>
            创建
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="名称" hint={nameError ?? undefined}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my_documents" autoFocus className={cn(nameError && "border-danger")} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="距离度量 (space)" hint="创建后不可修改">
            <Select value={space} onChange={(e) => setSpace(e.target.value as Space)}>
              <option value="cosine">cosine 余弦</option>
              <option value="l2">l2 欧氏距离²</option>
              <option value="ip">ip 内积</option>
            </Select>
          </Field>
          <Field label="Embedding 函数" hint="写入集合配置，供文本写入与检索使用">
            <Select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              {profiles?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="">不声明（仅手动传入向量）</option>
            </Select>
          </Field>
        </div>

        <Field label="Metadata（可选，JSON 对象）">
          <JsonEditor value={metadata} onChange={setMetadata} minHeight="64px" placeholder='{ "description": "…" }' />
        </Field>

        <button onClick={() => setAdvanced(!advanced)} className="flex items-center gap-1 text-xs font-medium text-muted hover:text-fg">
          <ChevronRight className={cn("size-3.5 transition-transform", advanced && "rotate-90")} />
          HNSW 索引参数
        </button>
        {advanced ? (
          <div className="grid grid-cols-3 gap-3">
            <Field label="ef_construction" hint="建索引时的候选数，越大越准越慢">
              <Input type="number" min={1} value={efConstruction} onChange={(e) => setEfConstruction(e.target.value)} />
            </Field>
            <Field label="ef_search" hint="查询时的候选数，可后续修改">
              <Input type="number" min={1} value={efSearch} onChange={(e) => setEfSearch(e.target.value)} />
            </Field>
            <Field label="max_neighbors" hint="每个节点的最大邻居数 (M)">
              <Input type="number" min={2} value={maxNeighbors} onChange={(e) => setMaxNeighbors(e.target.value)} />
            </Field>
          </div>
        ) : null}

        <ErrorBox error={create.error} />
      </div>
    </Dialog>
  );
}
