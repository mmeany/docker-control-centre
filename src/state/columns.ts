// Column layouts the user sets on a list (FileList): widths by column id,
// remembered per kind of list in settings values under `columns.<key>`.
// Columns without a stored width use their default.
//
// Module-level (like help/store.ts) so a FileList needs no Shell: the shell
// seeds it once from the settings it loads, and changes are saved through
// `appApi.setValue` when a drag ends.
import { useCallback, useId, useSyncExternalStore } from "react";
import { appApi } from "../api/app";

/** Narrowest a column can be dragged. */
export const MIN_COL_W = 40;
/** Widest a column can be dragged or fitted. */
export const MAX_COL_W = 2000;
/** Settings values key prefix. */
export const COLUMNS_PREFIX = "columns.";

export interface ColumnLayout {
  /** px by column id; only columns the user changed. */
  widths: Record<string, number>;
}

const EMPTY: ColumnLayout = { widths: {} };

export const clampWidth = (w: number) => Math.round(Math.min(MAX_COL_W, Math.max(MIN_COL_W, w)));

/** A stored value, made safe: anything that isn't a sane width is dropped. */
export function readColumnLayout(v: unknown): ColumnLayout {
  if (!v || typeof v !== "object" || Array.isArray(v)) return EMPTY;
  const raw = (v as { widths?: unknown }).widths;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY;
  const widths: Record<string, number> = {};
  for (const [id, w] of Object.entries(raw)) if (typeof w === "number" && Number.isFinite(w)) widths[id] = clampWidth(w);
  return { widths };
}

/** The value to store for `layout`, keeping only `ids` (null: nothing left, remove the key). */
export function storedColumnLayout(layout: ColumnLayout, ids: string[]): ColumnLayout | null {
  const widths: Record<string, number> = {};
  for (const id of ids) if (layout.widths[id] !== undefined) widths[id] = layout.widths[id];
  return Object.keys(widths).length ? { widths } : null;
}

/** Each column's width: the stored one, else the column's default. */
export function columnWidths(columns: { id: string; width: number }[], layout: ColumnLayout): number[] {
  return columns.map((c) => layout.widths[c.id] ?? c.width);
}

/** CSS grid template: fixed columns, the last one at least its width and filling the rest. */
export function gridTemplate(widths: number[]): string {
  return widths.map((w, i) => (i === widths.length - 1 ? `minmax(${w}px, 1fr)` : `${w}px`)).join(" ");
}

// ---------------------------------------------------------------------------
// Store

let layouts: Record<string, ColumnLayout> = {};
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Called by the shell once settings are loaded (main window and pop-outs). */
export function seedColumnLayouts(values: Record<string, unknown>) {
  layouts = {};
  for (const [k, v] of Object.entries(values)) if (k.startsWith(COLUMNS_PREFIX)) layouts[k.slice(COLUMNS_PREFIX.length)] = readColumnLayout(v);
  notify();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function put(key: string, layout: ColumnLayout, ids: string[], persist: boolean, remembered: boolean) {
  layouts = { ...layouts, [key]: layout };
  notify();
  if (persist && remembered) appApi.setValue(COLUMNS_PREFIX + key, storedColumnLayout(layout, ids)).catch(() => {});
}

/**
 * The layout for one list, and the actions that change it. Without a key the
 * list can still be resized; it just isn't remembered.
 */
export function useColumnLayout(key: string | undefined, ids: string[]) {
  const local = useId();
  const k = key ?? `local:${local}`;
  const layout = useSyncExternalStore(subscribe, () => layouts[k] ?? EMPTY);
  const idsKey = ids.join("\n");

  /** Sets one column's width; `persist` saves it (false while dragging). */
  const setWidth = useCallback(
    (id: string, w: number, persist = true) => {
      const cur = layouts[k] ?? EMPTY;
      put(k, { ...cur, widths: { ...cur.widths, [id]: clampWidth(w) } }, idsKey.split("\n"), persist, key !== undefined);
    },
    [k, key, idsKey],
  );

  const reset = useCallback(() => put(k, EMPTY, [], true, key !== undefined), [k, key]);

  return { layout, setWidth, reset, hasCustom: Object.keys(layout.widths).length > 0 };
}
