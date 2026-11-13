// A data-table whose columns can be resized: auto-sized (as the browser lays
// it out) until the first drag or fit, which freezes every column at its
// current width (fixed layout, a colgroup). The last column then fills the
// rest, at least its own width, as in FileList. Widths are remembered per
// kind of table in settings values `columns.table.<kind>`; Reset column
// widths (header right-click) goes back to auto.
import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useColumnLayout } from "../state/columns";
import { contentWidth, dragColumn } from "./columnDrag";
import { ContextMenu } from "./ContextMenu";

export interface TableColumn {
  id: string;
  label: ReactNode;
  /** On the header cell (e.g. "right"). */
  className?: string;
}

interface Props {
  /** The kind of table (`env`, `mounts`, ...): tables of one kind share widths. */
  tableKey: string;
  columns: TableColumn[];
  className?: string;
  /** The table's tbody. */
  children: ReactNode;
}

/** Header cell padding (left + right), as `.data-table th` in styles.css. */
const TH_PAD = 16;

export function ResizableTable({ tableKey, columns, className = "data-table", children }: Props) {
  const ids = columns.map((c) => c.id);
  const cols = useColumnLayout(`table.${tableKey}`, ids);
  const ref = useRef<HTMLTableElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const fixed = ids.every((id) => cols.layout.widths[id] !== undefined);
  const last = columns.length - 1;

  const heads = () => Array.from(ref.current?.tHead?.rows[0]?.cells ?? []);

  /** Width column `i` needs untruncated: its heading and every cell, unwrapped. */
  function fitWidth(i: number): number {
    const table = ref.current;
    if (!table) return 0;
    table.classList.add("measuring");
    let w = contentWidth(heads()[i]?.querySelector(".dt-label")) + TH_PAD;
    for (const body of Array.from(table.tBodies)) for (const row of Array.from(body.rows)) w = Math.max(w, contentWidth(row.cells[i]));
    table.classList.remove("measuring");
    return w;
  }

  /**
   * Every column's width now, to freeze them with the one being changed. The
   * last column fills the table, so it keeps its own width (or what it needs),
   * not the space it happens to fill.
   */
  function current(): Record<string, number> {
    const out: Record<string, number> = {};
    heads().forEach((th, i) => {
      const w = th.getBoundingClientRect().width;
      out[ids[i]] = i === last ? (cols.layout.widths[ids[i]] ?? Math.min(w, fitWidth(i))) : w;
    });
    return out;
  }

  function startResize(e: PointerEvent<HTMLSpanElement>, i: number) {
    const base = current();
    const startW = e.currentTarget.parentElement!.getBoundingClientRect().width;
    dragColumn(
      e,
      startW,
      (w) => cols.setWidths({ ...base, [ids[i]]: w }, false),
      (w) => cols.setWidths({ ...base, [ids[i]]: w }),
    );
  }

  function fit(i: number) {
    cols.setWidths({ ...current(), [ids[i]]: fitWidth(i) });
  }

  const total = fixed ? ids.reduce((sum, id) => sum + cols.layout.widths[id], 0) : 0;
  return (
    <>
      <table ref={ref} className={`${className} resizable ${fixed ? "fixed" : ""}`} style={fixed ? { width: `max(100%, ${total}px)` } : undefined}>
        {fixed && (
          <colgroup>
            {columns.map((c, i) => (
              // The last column takes what's left (at least its width, through the table's width).
              <col key={c.id} style={i < last ? { width: cols.layout.widths[c.id] } : undefined} />
            ))}
          </colgroup>
        )}
        <thead
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          <tr>
            {columns.map((c, i) => (
              <th key={c.id} className={c.className} data-col={c.id}>
                <span className="dt-label">{c.label}</span>
                <span
                  className="fl-resize"
                  title="Drag to resize, double-click to fit"
                  onPointerDown={(e) => startResize(e, i)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    fit(i);
                  }}
                />
              </th>
            ))}
          </tr>
        </thead>
        {children}
      </table>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[{ label: "Reset column widths", onClick: cols.resetAll, disabled: !cols.hasWidths }]}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
