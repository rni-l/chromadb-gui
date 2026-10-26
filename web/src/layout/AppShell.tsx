import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  return (
    <div className="flex h-full min-h-0">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

/** Standard page header used by every route. */
export function PageHeader({ title, subtitle, actions, crumbs }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; crumbs?: React.ReactNode }) {
  return (
    <header className="shrink-0 border-b border-border bg-panel px-6 pt-4 pb-3">
      {crumbs ? <div className="mb-1.5 flex items-center gap-1 text-xs text-subtle">{crumbs}</div> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
          {subtitle ? <div className="mt-0.5 text-xs text-muted">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
