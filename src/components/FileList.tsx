import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { columnWidths, gridTemplate, useColumnLayout, visibleColumns } from "../state/columns";
import type { Status } from "../status/status";
import { ContextMenu } from "./ContextMenu";
import { StatusMark, statusTip } from "./StatusMark";

/** Explorer's views: details (columns), list (names flowing in columns), tiles. */
export type ViewMode = "details" | "list" | "tiles";

export interface Column {
  id: string;
  label: string;
  width: number;
  align?: "left" | "right";
}

export interface Row {
  key: string;
  icon: ReactNode;
  /** Folders/buckets sort before files regardless of sort column. */
  isContainer: boolean;
  /** Shown faded (e.g. cut to the clipboard). */
  dimmed?: boolean;
  /** Colours the name and adds the state mark; its reason is the tooltip. */
  status?: Status;
  cells: Record<string, Cell>;
}

export interface Cell {
  text: string;
  sort: string | number;
  /** Shown faded, e.g. a value that only applies later; say why in `title`. */
  muted?: boolean;
  title?: string;
}

interface Props {
  columns: Column[];
  rows: Row[];
  selected: Set<string>;
  onSelectionChange: (keys: Set<string>) => void;
  onOpen: (key: string) => void;
  /** Right-click on a row (key) or on empty space (null). */
  onContextMenu?: (key: string | null, x: number, y: number) => void;
  /** Reports row keys in display (sorted) order, e.g. for preview next/previous. */
  onOrderChange?: (keys: string[]) => void;
  emptyText: string;
  /** Default details. List and tiles aren't virtualised: fine for hundreds of rows. */
  view?: ViewMode;
  /**
   * Which kind of list this is, for remembering column widths (settings value
   * `columns.<key>`). Lists of one kind share it; without one, widths can
   * still be dragged but are forgotten.
   */
  columnsKey?: string;
}

type Sort = { col: string; dir: 1 | -1 };

/** Row height in px; must match .fl-row in styles.css. */
const ROW_H = 22;
/** Extra rows rendered above/below the viewport. */
const OVERSCAN = 12;

/**
 * Width an element needs to show its contents untruncated, padding included.
 * Measured with a Range: text keeps its full width when ellipsis hides it,
 * and it works whether the element is wider or narrower than its contents.
 */
function contentWidth(el: HTMLElement | undefined): number {
  if (!el) return 0;
  const range = document.createRange();
  range.selectNodeContents(el);
  const cs = getComputedStyle(el);
  return Math.ceil(range.getBoundingClientRect().width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)) + 1;
}

/** Details-view list with sortable columns and Explorer-style selection. */
export function FileList({ columns: allColumns, rows, selected, onSelectionChange, onOpen, onContextMenu, onOrderChange, emptyText, view = "details", columnsKey }: Props) {
  const [sort, setSort] = useState<Sort>({ col: allColumns[0].id, dir: 1 });
  const anchor = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const cols = useColumnLayout(
    columnsKey,
    allColumns.map((c) => c.id),
  );
  // Hidden columns are left out everywhere: details, tiles' sub-lines, sorting.
  const columns = visibleColumns(allColumns, cols.layout);
  // Sorted by a column that's since been hidden: by the first (Name) instead.
  const sortCol = columns.some((c) => c.id === sort.col) ? sort.col : columns[0].id;
  const sortDir = sortCol === sort.col ? sort.dir : 1;
  const [headMenu, setHeadMenu] = useState<{ x: number; y: number } | null>(null);
  // Virtualisation: only rows near the viewport are in the DOM.
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);

  // The body's vertical scrollbar width, kept off the header so columns line up.
  const [gutter, setGutter] = useState(0);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewH(el.clientHeight);
      setGutter(el.offsetWidth - el.clientWidth);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      if (a.isContainer !== b.isContainer) return a.isContainer ? -1 : 1;
      const av = a.cells[sortCol]?.sort ?? "";
      const bv = b.cells[sortCol]?.sort ?? "";
      const c =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
      return c * sortDir;
    });
    return out;
  }, [rows, sortCol, sortDir]);

  useEffect(() => onOrderChange?.(sorted.map((r) => r.key)), [sorted, onOrderChange]);

  // Drop the shift-anchor when the row set changes.
  useEffect(() => {
    anchor.current = null;
  }, [rows]);

  /** Scrolls so row `index` is fully visible. */
  function ensureVisible(index: number) {
    const el = bodyRef.current;
    if (!el) return;
    if (view !== "details") {
      el.querySelectorAll<HTMLElement>("[data-key]")[index]?.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    const top = index * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  }

  function clickRow(e: MouseEvent, key: string) {
    if (e.shiftKey && anchor.current) {
      const keys = sorted.map((r) => r.key);
      const a = keys.indexOf(anchor.current);
      const b = keys.indexOf(key);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const range = new Set(keys.slice(lo, hi + 1));
      if (e.ctrlKey) selected.forEach((k) => range.add(k));
      onSelectionChange(range);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      anchor.current = key;
      onSelectionChange(next);
      return;
    }
    anchor.current = key;
    onSelectionChange(new Set([key]));
  }

  function onKeyDown(e: KeyboardEvent) {
    if (sorted.length === 0) return;
    const keys = sorted.map((r) => r.key);
    const current = anchor.current && keys.includes(anchor.current) ? keys.indexOf(anchor.current) : -1;
    const step: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
    if (view !== "details") Object.assign(step, { ArrowRight: 1, ArrowLeft: -1 });
    if (e.key in step) {
      e.preventDefault();
      const next = Math.min(keys.length - 1, Math.max(0, current + step[e.key]));
      anchor.current = keys[next];
      onSelectionChange(new Set([keys[next]]));
      ensureVisible(next);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const i = e.key === "Home" ? 0 : keys.length - 1;
      anchor.current = keys[i];
      onSelectionChange(new Set([keys[i]]));
      ensureVisible(i);
    } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSelectionChange(new Set(keys));
    } else if (e.key === "Enter" && !e.altKey && selected.size === 1) {
      e.preventDefault();
      onOpen([...selected][0]);
    }
  }

  function headerClick(col: string) {
    setSort(sortCol === col ? { col, dir: (sortDir * -1) as 1 | -1 } : { col, dir: 1 });
  }

  const onBodyContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-key]");
    const key = row?.dataset.key ?? null;
    if (key === null) onSelectionChange(new Set());
    else if (!selected.has(key)) {
      anchor.current = key;
      onSelectionChange(new Set([key]));
    }
    onContextMenu?.(key, e.clientX, e.clientY);
  };
  const onBodyClick = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest("[data-key]")) onSelectionChange(new Set());
  };

  if (view !== "details") {
    const [second, third] = columns.slice(1).map((c) => c.id);
    return (
      <div className="file-list" tabIndex={0} onKeyDown={onKeyDown}>
        <div className={`fl-flow fl-${view}`} ref={bodyRef} onContextMenu={onBodyContextMenu} onClick={onBodyClick}>
          {sorted.length === 0 && <div className="empty-note">{emptyText}</div>}
          {sorted.map((r) => (
            <div
              key={r.key}
              data-key={r.key}
              className={`fl-item ${selected.has(r.key) ? "selected" : ""} ${r.dimmed ? "dimmed" : ""}`}
              title={`${r.cells[columns[0].id]?.text ?? ""}${r.status ? ` · ${statusTip(r.status)}` : ""}`}
              onClick={(e) => clickRow(e, r.key)}
              onDoubleClick={() => onOpen(r.key)}
            >
              {r.status && <StatusMark status={r.status} />}
              <span className="fl-icon">{r.icon}</span>
              {view === "list" ? (
                <span className={`fl-item-name fl-name ${r.status ? `st-${r.status.state}` : ""}`}>{r.cells[columns[0].id]?.text ?? ""}</span>
              ) : (
                <span className="fl-tile-text">
                  <span className={`fl-item-name fl-name ${r.status ? `st-${r.status.state}` : ""}`}>{r.cells[columns[0].id]?.text ?? ""}</span>
                  {/* Tiles hold three lines: with a status, it takes the second. */}
                  {r.status && <span className={`fl-tile-sub st-${r.status.state}`}>{r.status.label}</span>}
                  {second && <span className="fl-tile-sub">{r.cells[second]?.text ?? ""}</span>}
                  {third && !r.status && <span className="fl-tile-sub">{r.cells[third]?.text ?? ""}</span>}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const widths = columnWidths(columns, cols.layout);
  const template = gridTemplate(widths);
  // Rows sit inside a 2px margin; the header lines up with the canvas.
  const minWidth = widths.reduce((a, b) => a + b, 0) + 4;
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(sorted.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);
  const visible = sorted.slice(first, last);

  /** Pointer-down on a header edge: the column follows the pointer, saved on release. */
  function startResize(e: PointerEvent<HTMLSpanElement>, id: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    // The rendered width, so a filling last column grows from where its edge is.
    const startW = el.parentElement!.getBoundingClientRect().width;
    const x0 = e.clientX;
    let w = startW;
    el.setPointerCapture(e.pointerId);
    document.body.classList.add("col-resizing");
    const move = (ev: globalThis.PointerEvent) => {
      w = startW + ev.clientX - x0;
      cols.setWidth(id, w, false);
    };
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      document.body.classList.remove("col-resizing");
      if (w !== startW) cols.setWidth(id, w);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  /** Double-click on a header edge: as wide as the header or the widest rendered cell. */
  function fit(index: number) {
    let w = contentWidth(headRef.current?.querySelectorAll<HTMLElement>(".fl-head-cell")[index]);
    bodyRef.current?.querySelectorAll<HTMLElement>(`.fl-row > :nth-child(${index + 1})`).forEach((cell) => {
      w = Math.max(w, contentWidth(cell));
    });
    if (w > 0) cols.setWidth(columns[index].id, w);
  }

  return (
    <div className="file-list" tabIndex={0} onKeyDown={onKeyDown}>
      <div
        className="fl-header"
        ref={headRef}
        style={{ paddingRight: gutter }}
        // Focusing a header cell can scroll the header itself: the rows follow.
        onScroll={(e) => {
          const body = bodyRef.current;
          if (body && body.scrollLeft !== e.currentTarget.scrollLeft) body.scrollLeft = e.currentTarget.scrollLeft;
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setHeadMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <div className="fl-head-row" style={{ gridTemplateColumns: template, minWidth }}>
          {columns.map((c, i) => (
            <div key={c.id} className="fl-head-wrap" data-col={c.id}>
              <button className={`fl-head-cell ${c.align === "right" ? "right" : ""}`} onClick={() => headerClick(c.id)}>
                {c.label}
                {sortCol === c.id && <span className="sort-arrow">{sortDir === 1 ? "▲" : "▼"}</span>}
              </button>
              <span
                className="fl-resize"
                title="Drag to resize, double-click to fit"
                onPointerDown={(e) => startResize(e, c.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  fit(i);
                }}
              />
            </div>
          ))}
        </div>
      </div>
      {headMenu && (
        <ContextMenu
          x={headMenu.x}
          y={headMenu.y}
          items={[
            // A tick per column; the first (Name) is always shown.
            ...allColumns.map((c, i) => ({
              label: c.label,
              checked: i === 0 || !cols.layout.hidden.includes(c.id),
              disabled: i === 0,
              onClick: () => cols.toggleHidden(c.id),
            })),
            "separator" as const,
            { label: "Reset column widths", onClick: cols.resetWidths, disabled: !cols.hasWidths },
            { label: "Reset columns", onClick: cols.resetAll, disabled: !cols.hasWidths && !cols.hasHidden },
          ]}
          onClose={() => setHeadMenu(null)}
        />
      )}
      <div
        className="fl-body"
        ref={bodyRef}
        onScroll={(e) => {
          setScrollTop(e.currentTarget.scrollTop);
          const head = headRef.current;
          if (head && head.scrollLeft !== e.currentTarget.scrollLeft) head.scrollLeft = e.currentTarget.scrollLeft;
        }}
        onContextMenu={onBodyContextMenu}
        onClick={onBodyClick}
      >
        {sorted.length === 0 && <div className="empty-note">{emptyText}</div>}
        <div className="fl-canvas" style={{ height: sorted.length * ROW_H, minWidth, position: "relative" }}>
        {visible.map((r, i) => (
          <div
            key={r.key}
            data-key={r.key}
            className={`fl-row ${selected.has(r.key) ? "selected" : ""} ${r.dimmed ? "dimmed" : ""}`}
            style={{ gridTemplateColumns: template, position: "absolute", top: (first + i) * ROW_H, left: 0, right: 0 }}
            title={r.status ? statusTip(r.status) : undefined}
            onClick={(e) => clickRow(e, r.key)}
            onDoubleClick={() => onOpen(r.key)}
          >
            {columns.map((c, i) =>
              i === 0 ? (
                <span key={c.id} className="fl-cell">
                  {r.status && <StatusMark status={r.status} />}
                  <span className="fl-icon">{r.icon}</span>
                  <span className={`fl-name ${r.status ? `st-${r.status.state}` : ""}`}>{r.cells[c.id]?.text ?? ""}</span>
                </span>
              ) : (
                <span
                  key={c.id}
                  className={`fl-cell ${c.align === "right" ? "right" : ""} ${r.cells[c.id]?.muted ? "muted" : ""}`}
                  title={r.cells[c.id]?.title}
                >
                  {r.cells[c.id]?.text ?? ""}
                </span>
              ),
            )}
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}
