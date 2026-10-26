import { json } from "@codemirror/lang-json";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { cn } from "@/lib/utils";

// Colors come from the app's CSS tokens so the editor follows light/dark.
const theme = EditorView.theme({
  "&": { backgroundColor: "var(--panel)", color: "var(--fg)" },
  ".cm-content": { fontFamily: "var(--font-mono)", caretColor: "var(--accent)" },
  ".cm-gutters": { backgroundColor: "var(--sunken)", color: "var(--fg-subtle)", borderRight: "1px solid var(--border)" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "var(--accent-soft) !important" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
});

export function JsonEditor({
  value,
  onChange,
  minHeight = "120px",
  maxHeight = "360px",
  placeholder,
  className,
  readOnly,
}: {
  value: string;
  onChange?: (v: string) => void;
  minHeight?: string;
  maxHeight?: string;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
}) {
  return (
    <div className={cn("overflow-hidden rounded-md border border-border focus-within:border-accent focus-within:ring-2 focus-within:ring-[var(--ring)]", className)}>
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={[json(), theme, EditorView.lineWrapping]}
        theme="none"
        readOnly={readOnly}
        placeholder={placeholder}
        minHeight={minHeight}
        maxHeight={maxHeight}
        basicSetup={{ foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false }}
      />
    </div>
  );
}
