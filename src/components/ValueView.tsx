import { useMemo, useState } from "react";
import { DataTree } from "./DataTree";

export type ValueFormat = "json" | "text";

/** JSON objects / arrays are worth showing as a tree. (Add YAML by parsing it in Rust: see CLAUDE.md.) */
export function detectFormat(value: string): ValueFormat {
  const t = value.trim();
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      JSON.parse(t);
      return "json";
    } catch {
      return "text";
    }
  }
  return "text";
}

interface Props {
  value: string;
  /** Initial mode; "auto" picks tree for JSON. */
  initial?: "auto" | "text";
}

/** Shows a value as text, or as a collapsible tree when it is JSON. */
export function ValueView({ value, initial = "auto" }: Props) {
  const format = detectFormat(value);
  const [mode, setMode] = useState<"tree" | "text">(initial === "auto" && format !== "text" ? "tree" : "text");
  const parsed = useMemo(() => (format === "json" ? { value: JSON.parse(value) as unknown } : null), [value, format]);

  return (
    <div className="value-view">
      {format !== "text" && (
        <div className="segmented small">
          <button className={mode === "tree" ? "active" : ""} onClick={() => setMode("tree")}>
            Tree
          </button>
          <button className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}>
            Text
          </button>
        </div>
      )}
      {mode === "tree" && format !== "text" ? (
        parsed ? (
          <DataTree value={parsed.value} rootName="JSON" />
        ) : (
          <pre className="value-text">{value}</pre>
        )
      ) : (
        <pre className="value-text">{value}</pre>
      )}
    </div>
  );
}
