// A dashboard list: the same columns and rows a section gives FileList, shown
// as a roomy table (optionally with rows under a row, e.g. a project's
// containers) or as cards. Each row has check-box selection, inline action
// buttons and a "More" menu (the section's context menu); selecting rows shows
// a bulk action bar. Click selects, Ctrl+click adds, double-click or the name
// opens, Enter opens the one selected row. Not virtualised: boards are for
// lists of hundreds, not tens of thousands (FileList is).
import { useMemo, useState, type ReactNode } from "react";
import type { Column, Row } from "./FileList";
import { StatusMark, statusTip } from "./StatusMark";

export interface BoardAction {
  label: string;
  icon?: ReactNode;
  title?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

interface Props {
  columns: Column[];
  rows: Row[];
  /** Rows shown under a row (a project's containers); expanded until collapsed. */
  childrenOf?: (key: string) => Row[];
  layout?: "table" | "cards";
  selected: Set<string>;
  onSelectionChange: (keys: Set<string>) => void;
  onOpen: (key: string) => void;
  /** The section's context menu: a row (null: the background) at a point. */
  onMenu: (key: string | null, x: number, y: number) => void;
  /** Inline buttons for a row. */
  actions?: (key: string) => BoardAction[];
  /** The bar shown while rows are selected (acting on the selection). */
  bulk?: BoardAction[];
  emptyText: string;
}

type Sort = { col: string; asc: boolean } | null;

function compare(a: Row, b: Row, col: string, asc: boolean): number {
  if (a.isContainer !== b.isContainer) return a.isContainer ? -1 : 1;
  const x = a.cells[col]?.sort ?? "";
  const y = b.cells[col]?.sort ?? "";
  const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
  return asc ? r : -r;
}

export function Board({ columns, rows, childrenOf, layout = "table", selected, onSelectionChange, onOpen, onMenu, actions, bulk, emptyText }: Props) {
  const [sort, setSort] = useState<Sort>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const sorted = useMemo(() => (sort ? [...rows].sort((a, b) => compare(a, b, sort.col, sort.asc)) : rows), [rows, sort]);
  const kids = (key: string) => {
    const list = childrenOf?.(key) ?? [];
    return sort ? [...list].sort((a, b) => compare(a, b, sort.col, sort.asc)) : list;
  };
  const allKeys = useMemo(() => sorted.flatMap((r) => [r.key, ...(childrenOf ? (childrenOf(r.key) ?? []).map((c) => c.key) : [])]), [sorted, childrenOf]);
  const [name, ...rest] = columns;
  const grid = `28px minmax(0, ${name.width}fr) ${rest.map((c) => `minmax(0, ${c.width}fr)`).join(" ")} auto`;

  const toggle = (key: string) => {
    const n = new Set(selected);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    onSelectionChange(n);
  };
  const click = (e: React.MouseEvent, key: string) => {
    if ((e.target as HTMLElement).closest("button, input")) return;
    if (e.ctrlKey || e.metaKey) toggle(key);
    else onSelectionChange(new Set([key]));
  };
  const menu = (e: React.MouseEvent, key: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (key && !selected.has(key)) onSelectionChange(new Set([key]));
    onMenu(key, e.clientX, e.clientY);
  };
  const more = (e: React.MouseEvent<HTMLButtonElement>, key: string) => {
    e.stopPropagation();
    if (!selected.has(key)) onSelectionChange(new Set([key]));
    const r = e.currentTarget.getBoundingClientRect();
    onMenu(key, r.left, r.bottom);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("button, input")) return;
    if (e.key === "Enter" && selected.size === 1) {
      e.preventDefault();
      onOpen([...selected][0]);
    } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSelectionChange(new Set(allKeys));
    } else if (e.key === "Escape" && selected.size) {
      onSelectionChange(new Set());
    }
  };

  const rowActions = (key: string, labels: boolean) => (
    <span className="bd-actions">
      {(actions?.(key) ?? []).map((a) => (
        <button
          key={a.label}
          className={labels ? `btn ${a.danger ? "danger" : ""}` : `tool-btn bd-act ${a.danger ? "danger" : ""}`}
          title={a.title ?? a.label}
          aria-label={a.label}
          disabled={a.disabled}
          onClick={(e) => {
            e.stopPropagation();
            a.onClick();
          }}
        >
          {labels ? a.label : a.icon ?? a.label}
        </button>
      ))}
      <button className="tool-btn bd-act" title="More" aria-label="More" onClick={(e) => more(e, key)}>
        ⋯
      </button>
    </span>
  );

  const nameCell = (r: Row) => (
    <span className="bd-name-cell">
      {r.status ? <StatusMark status={r.status} /> : <span className="tree-mark-gap" />}
      <span className="fl-icon">{r.icon}</span>
      <button className={`bd-name fl-name ${r.status ? `st-${r.status.state}` : ""}`} title={r.status ? `${r.cells[name.id]?.text ?? ""} · ${statusTip(r.status)}` : r.cells[name.id]?.text} onClick={() => onOpen(r.key)}>
        {r.cells[name.id]?.text ?? ""}
      </button>
    </span>
  );

  const bar =
    selected.size > 0 && bulk ? (
      <div className="bd-bulk" role="toolbar" aria-label="Selected">
        <span className="bd-bulk-count">{selected.size.toLocaleString()} selected</span>
        {bulk.map((a) => (
          <button key={a.label} className={`btn ${a.danger ? "danger" : ""}`} title={a.title ?? a.label} disabled={a.disabled} onClick={a.onClick}>
            {a.label}
          </button>
        ))}
        <div className="spacer" />
        <button className="link-btn" onClick={() => onSelectionChange(new Set())}>
          Clear selection
        </button>
      </div>
    ) : null;

  if (rows.length === 0)
    return (
      <div className="board" onContextMenu={(e) => menu(e, null)}>
        <div className="empty-note center">{emptyText}</div>
      </div>
    );

  if (layout === "cards")
    return (
      <div className="board" tabIndex={0} onKeyDown={onKey} onContextMenu={(e) => menu(e, null)}>
        {bar}
        <div className="bd-cards">
          {sorted.map((r) => (
            <div
              key={r.key}
              className={`bd-card ${selected.has(r.key) ? "selected" : ""} ${r.dimmed ? "dimmed" : ""}`}
              onClick={(e) => click(e, r.key)}
              onDoubleClick={() => onOpen(r.key)}
              onContextMenu={(e) => menu(e, r.key)}
            >
              <div className="bd-card-head">
                <input type="checkbox" aria-label={`Select ${r.cells[name.id]?.text}`} checked={selected.has(r.key)} onChange={() => toggle(r.key)} />
                {nameCell(r)}
              </div>
              <dl className="bd-card-props">
                {rest
                  .filter((c) => r.cells[c.id]?.text)
                  .map((c) => (
                    <div key={c.id}>
                      <dt>{c.label}</dt>
                      <dd title={r.cells[c.id].text}>{r.cells[c.id].text}</dd>
                    </div>
                  ))}
              </dl>
              {rowActions(r.key, true)}
            </div>
          ))}
        </div>
      </div>
    );

  const line = (r: Row, depth: number) => {
    const children = depth === 0 ? kids(r.key) : [];
    const open = !collapsed.has(r.key);
    return (
      <div key={r.key} role="rowgroup">
        <div
          role="row"
          aria-selected={selected.has(r.key)}
          className={`bd-row ${selected.has(r.key) ? "selected" : ""} ${r.dimmed ? "dimmed" : ""} ${depth ? "child" : ""} ${children.length ? "parent" : ""}`}
          style={{ gridTemplateColumns: grid }}
          onClick={(e) => click(e, r.key)}
          onDoubleClick={() => onOpen(r.key)}
          onContextMenu={(e) => menu(e, r.key)}
        >
          <input type="checkbox" aria-label={`Select ${r.cells[name.id]?.text}`} checked={selected.has(r.key)} onChange={() => toggle(r.key)} />
          <span className="bd-cell bd-first">
            {children.length > 0 ? (
              <button
                className="bd-twisty"
                aria-expanded={open}
                title={open ? "Collapse" : "Expand"}
                onClick={() =>
                  setCollapsed((s) => {
                    const n = new Set(s);
                    if (n.has(r.key)) n.delete(r.key);
                    else n.add(r.key);
                    return n;
                  })
                }
              >
                {open ? "▾" : "▸"}
              </button>
            ) : (
              <span className={`bd-twisty-gap ${depth ? "deep" : ""}`} />
            )}
            {nameCell(r)}
          </span>
          {rest.map((c) => (
            <span key={c.id} className={`bd-cell ${c.align === "right" ? "right" : ""}`} title={r.cells[c.id]?.text}>
              {r.cells[c.id]?.text ?? ""}
            </span>
          ))}
          {rowActions(r.key, false)}
        </div>
        {open && children.map((c) => line(c, 1))}
      </div>
    );
  };

  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  return (
    <div className="board" tabIndex={0} onKeyDown={onKey} onContextMenu={(e) => menu(e, null)} role="grid" aria-multiselectable>
      {bar}
      <div className="bd-head" role="row" style={{ gridTemplateColumns: grid }}>
        <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => onSelectionChange(allSelected ? new Set() : new Set(allKeys))} />
        {columns.map((c) => (
          <button
            key={c.id}
            role="columnheader"
            className={`bd-head-cell ${c.align === "right" ? "right" : ""}`}
            onClick={() => setSort((s) => (s?.col === c.id ? (s.asc ? { col: c.id, asc: false } : null) : { col: c.id, asc: true }))}
          >
            {c.label}
            {sort?.col === c.id && <span className="sort-arrow">{sort.asc ? "▲" : "▼"}</span>}
          </button>
        ))}
        <span />
      </div>
      <div className="bd-body">{sorted.map((r) => line(r, 0))}</div>
    </div>
  );
}
