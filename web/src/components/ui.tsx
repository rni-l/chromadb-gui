import { Dialog as D, DropdownMenu as DM, Tabs as T, Tooltip as TT } from "radix-ui";
import { AlertCircle, Inbox, Loader2, X } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// ---- Button ---------------------------------------------------------------

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "icon" | "icon-sm";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:brightness-110 shadow-sm",
  secondary: "bg-sunken text-fg hover:bg-hover border border-border",
  outline: "border border-border bg-panel text-fg hover:bg-hover",
  ghost: "text-muted hover:text-fg hover:bg-hover",
  danger: "bg-danger text-white hover:brightness-110",
};
const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-8 px-3 text-[13px] gap-2",
  icon: "h-8 w-8 justify-center",
  "icon-sm": "h-6 w-6 justify-center",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 items-center rounded-md font-medium whitespace-nowrap transition-[background,filter,color] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="animate-spin" /> : null}
      {children}
    </button>
  );
});

// ---- Form controls ------------------------------------------------------

const control =
  "w-full rounded-md border border-border bg-panel px-2.5 text-[13px] text-fg placeholder:text-subtle transition-colors hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(control, "h-8", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(control, "py-2 leading-relaxed", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, "h-8 cursor-pointer pr-7", className)} {...rest}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint ? <span className="text-[11px] leading-snug text-subtle">{hint}</span> : null}
    </label>
  );
}

// ---- Feedback -----------------------------------------------------------

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "accent" | "success" | "danger" | "warn"; className?: string }) {
  const tones = {
    neutral: "bg-sunken text-muted border-border",
    accent: "bg-accent-soft text-accent-text border-transparent",
    success: "bg-success-soft text-success border-transparent",
    danger: "bg-danger-soft text-danger border-transparent",
    warn: "bg-warn-soft text-warn border-transparent",
  };
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded border px-1.5 text-[11px] font-medium whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-subtle", className)} />;
}

export function Empty({ icon, title, children, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-14 text-center", className)}>
      <div className="mb-1 text-subtle [&_svg]:size-8">{icon ?? <Inbox />}</div>
      <div className="text-sm font-medium">{title}</div>
      {children ? <div className="max-w-md text-xs leading-relaxed text-muted">{children}</div> : null}
    </div>
  );
}

export function ErrorBox({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  return (
    <div className={cn("flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-xs leading-relaxed text-danger", className)}>
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      <span className="break-words whitespace-pre-wrap">{error instanceof Error ? error.message : String(error)}</span>
    </div>
  );
}

// ---- Dialog -------------------------------------------------------------

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "max-w-lg",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] data-[state=open]:animate-in" />
        <D.Content
          className={cn(
            "fixed top-[8vh] left-1/2 z-50 flex max-h-[84vh] w-[calc(100vw-32px)] -translate-x-1/2 flex-col rounded-xl border border-border bg-panel shadow-pop",
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <D.Title className="text-[15px] font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-xs text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="关闭">
                <X />
              </Button>
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Right-side sheet for record details. */
export function Sheet({ open, onOpenChange, title, children, footer }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/25" />
        <D.Content className="fixed top-0 right-0 z-50 flex h-full w-[min(640px,100vw)] flex-col border-l border-border bg-panel shadow-pop">
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
            <D.Title className="min-w-0 truncate text-sm font-semibold">{title}</D.Title>
            <D.Description className="sr-only">记录详情</D.Description>
            <D.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="关闭">
                <X />
              </Button>
            </D.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// ---- Tabs ---------------------------------------------------------------

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return <T.List className={cn("flex items-center gap-1", className)}>{children}</T.List>;
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <T.Trigger
      value={value}
      className="relative inline-flex h-9 items-center gap-1.5 px-2.5 text-[13px] font-medium text-muted transition-colors hover:text-fg data-[state=active]:text-fg after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent after:opacity-0 data-[state=active]:after:opacity-100 [&_svg]:size-3.5"
    >
      {children}
    </T.Trigger>
  );
}

// ---- Menu ---------------------------------------------------------------

export function Menu({ trigger, children, align = "end" }: { trigger: ReactNode; children: ReactNode; align?: "start" | "end" }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} sideOffset={4} className="z-50 min-w-40 rounded-lg border border-border bg-panel p-1 shadow-pop">
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function MenuItem({ children, onSelect, danger }: { children: ReactNode; onSelect: () => void; danger?: boolean }) {
  return (
    <DM.Item
      onSelect={onSelect}
      className={cn(
        "flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] outline-none select-none data-[highlighted]:bg-hover [&_svg]:size-3.5",
        danger ? "text-danger" : "text-fg",
      )}
    >
      {children}
    </DM.Item>
  );
}

export const MenuSeparator = () => <DM.Separator className="my-1 h-px bg-border" />;

// ---- Tooltip ------------------------------------------------------------

export const TooltipProvider = TT.Provider;

export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <TT.Root delayDuration={300}>
      <TT.Trigger asChild>{children}</TT.Trigger>
      <TT.Portal>
        <TT.Content sideOffset={4} className="z-50 max-w-xs rounded-md bg-fg px-2 py-1 text-[11px] leading-snug text-bg shadow-pop">
          {content}
        </TT.Content>
      </TT.Portal>
    </TT.Root>
  );
}

// ---- Misc ---------------------------------------------------------------

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-sunken px-1 font-mono text-[10px] text-muted">{children}</kbd>;
}

export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{children}</h3>
      {actions}
    </div>
  );
}
