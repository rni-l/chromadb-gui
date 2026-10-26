import type { ConnectionPublic } from "@shared/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  ChevronRight,
  Database,
  Layers,
  Monitor,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Sun,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ConnectionDialog } from "@/components/ConnectionDialog";
import { confirm } from "@/components/confirm";
import { Button, Menu, MenuItem, MenuSeparator, Spinner, Tip } from "@/components/ui";
import { api } from "@/lib/api";
import { keys, useCollections, useConnections, useDatabases } from "@/lib/queries";
import { cn, fmtNum } from "@/lib/utils";

export function Sidebar() {
  const { data: connections, isLoading } = useConnections();
  const [dialog, setDialog] = useState<{ open: boolean; editing?: ConnectionPublic }>({ open: false });

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-sunken">
      <Link to="/" className="flex h-12 shrink-0 items-center gap-2 px-4">
        <Logo />
        <span className="text-[14px] font-semibold tracking-tight">Chroma GUI</span>
      </Link>

      <div className="flex items-center justify-between px-4 pt-2 pb-1">
        <span className="text-[11px] font-semibold tracking-wider text-subtle uppercase">连接</span>
        <Tip content="新建连接">
          <Button variant="ghost" size="icon-sm" onClick={() => setDialog({ open: true })} aria-label="新建连接">
            <Plus />
          </Button>
        </Tip>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {isLoading ? <Spinner className="mx-auto mt-4" /> : null}
        {connections?.length === 0 ? (
          <button
            onClick={() => setDialog({ open: true })}
            className="mt-1 w-full rounded-md border border-dashed border-border-strong px-3 py-4 text-xs text-muted hover:border-accent hover:text-accent-text"
          >
            + 添加第一个连接
          </button>
        ) : null}
        {connections?.map((c) => (
          <ConnectionNode key={c.id} conn={c} onEdit={() => setDialog({ open: true, editing: c })} />
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-border p-2">
        <FooterLink to="/migrations" icon={<ArrowRightLeft />}>
          迁移 / 复制
        </FooterLink>
        <FooterLink to="/settings" icon={<Settings />}>
          设置
        </FooterLink>
        <ThemeToggle />
      </div>

      <ConnectionDialog open={dialog.open} editing={dialog.editing} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} />
    </aside>
  );
}

function ConnectionNode({ conn, onEdit }: { conn: ConnectionPublic; onEdit: () => void }) {
  const params = useParams();
  const active = params.cid === conn.id;
  const [open, setOpen] = useState(active);
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
  const { data: dbs, isLoading, error, refetch } = useDatabases(open ? conn.id : undefined);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const remove = useMutation({
    mutationFn: () => api.connections.remove(conn.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.connections });
      if (active) navigate("/");
      toast.success(`已删除连接「${conn.name}」`);
    },
  });

  return (
    <div className="mb-0.5">
      <div
        className={cn(
          "group flex h-8 items-center gap-1 rounded-md pr-1 pl-1 hover:bg-hover",
          active && !params.db && "bg-hover",
        )}
      >
        <button onClick={() => setOpen(!open)} className="flex size-5 items-center justify-center text-subtle" aria-label={open ? "折叠" : "展开"}>
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
        <Link to={`/c/${conn.id}`} onClick={() => setOpen(true)} className="flex min-w-0 flex-1 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full" style={{ background: conn.color || "var(--accent)" }} />
          <span className="truncate text-[13px] font-medium">{conn.name}</span>
        </Link>
        <Menu
          trigger={
            <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" aria-label="连接操作">
              <MoreHorizontal />
            </Button>
          }
        >
          <MenuItem onSelect={() => refetch()}>
            <RefreshCw /> 刷新
          </MenuItem>
          <MenuItem onSelect={onEdit}>
            <Pencil /> 编辑连接
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            danger
            onSelect={async () => {
              if (await confirm({ title: `删除连接「${conn.name}」？`, body: "只会删除本地保存的连接配置，不会影响 Chroma 中的数据。", danger: true, confirmText: "删除" }))
                remove.mutate();
            }}
          >
            <Trash2 /> 删除连接
          </MenuItem>
        </Menu>
      </div>

      {open ? (
        <div className="ml-3 border-l border-border pl-1.5">
          {isLoading ? <div className="px-2 py-1.5 text-xs text-subtle">加载中…</div> : null}
          {error ? (
            <button onClick={() => refetch()} className="block w-full truncate px-2 py-1.5 text-left text-xs text-danger" title={(error as Error).message}>
              连接失败 · 点击重试
            </button>
          ) : null}
          {dbs?.map((db) => <DatabaseNode key={db.name} cid={conn.id} db={db.name} />)}
        </div>
      ) : null}
    </div>
  );
}

function DatabaseNode({ cid, db }: { cid: string; db: string }) {
  const params = useParams();
  const active = params.cid === cid && params.db === db;
  const [open, setOpen] = useState(active);
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
  const { data: cols, isLoading } = useCollections(open ? cid : undefined, db);

  return (
    <div>
      <div className={cn("flex h-7 items-center gap-1 rounded-md pr-2 hover:bg-hover", active && !params.col && "bg-hover")}>
        <button onClick={() => setOpen(!open)} className="flex size-5 items-center justify-center text-subtle" aria-label={open ? "折叠" : "展开"}>
          <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
        </button>
        <Link to={`/c/${cid}/${encodeURIComponent(db)}`} onClick={() => setOpen(true)} className="flex min-w-0 flex-1 items-center gap-1.5 text-muted">
          <Database className="size-3.5 shrink-0" />
          <span className="truncate text-[12.5px]">{db}</span>
        </Link>
      </div>
      {open ? (
        <div className="ml-2.5 border-l border-border pl-1.5">
          {isLoading ? <div className="px-2 py-1 text-xs text-subtle">加载中…</div> : null}
          {cols?.length === 0 ? <div className="px-2 py-1 text-xs text-subtle">无集合</div> : null}
          {cols?.map((c) => (
            <NavLink
              key={c.id}
              to={`/c/${cid}/${encodeURIComponent(db)}/${encodeURIComponent(c.name)}`}
              className={({ isActive }) =>
                cn(
                  "flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-muted hover:bg-hover hover:text-fg",
                  isActive && "bg-accent-soft text-accent-text hover:bg-accent-soft hover:text-accent-text",
                )
              }
            >
              <Layers className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="font-mono text-[10.5px] text-subtle tabular-nums">{fmtNum(c.count)}</span>
            </NavLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FooterLink({ to, icon, children }: { to: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn("flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-muted hover:bg-hover hover:text-fg [&_svg]:size-4", isActive && "bg-hover text-fg")
      }
    >
      {icon}
      {children}
    </NavLink>
  );
}

type Theme = "system" | "light" | "dark";

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("theme") as Theme) || "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      if (theme === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);
  const next: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  const label = { system: "跟随系统", light: "浅色", dark: "深色" }[theme];
  const Icon = { system: Monitor, light: Sun, dark: Moon }[theme];
  return (
    <button onClick={() => setTheme(next[theme])} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-muted hover:bg-hover hover:text-fg">
      <Icon className="size-4" />
      主题：{label}
    </button>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-6", className)} aria-hidden>
      <circle cx="12" cy="16" r="9" fill="#f59e0b" opacity=".9" />
      <circle cx="20" cy="16" r="9" fill="#ea580c" opacity=".85" />
      <circle cx="16" cy="16" r="4" fill="#fff" opacity=".9" />
    </svg>
  );
}
