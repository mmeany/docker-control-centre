// Column layouts the user sets on a list (FileList): widths by column id and
// the columns they hid, remembered per kind of list in settings values under
// `columns.<key>`. Columns without a stored width use their default; the
// first column (Name) can't be hidden.
//
// Module-level (like help/store.ts) so a FileList needs no Shell: the shell
// seeds it once from the settings it loads, and changes are saved through
// `appApi.setValue` when a drag ends.
import { useCallback, useId, useSyncExternalStore } from "react";
import { appApi } from "../api/app";
import type { Settings } from "../api/core";

/** Narrowest a column can be dragged. */
export const MIN_COL_W = 40;
/** Widest a column can be dragged or fitted. */
export const MAX_COL_W = 2000;
/** Settings values key prefix. */
export const COLUMNS_PREFIX = "columns.";

export interface ColumnLayout {
  /** px by column id; only columns the user changed. */
  widths: Record<string, number>;
  /** Ids of columns the user hid. */
  hidden: string[];
}

const EMPTY: ColumnLayout = { widths: {}, hidden: [] };

export const clampWidth = (w: number) => Math.round(Math.min(MAX_COL_W, Math.max(MIN_COL_W, w)));

/** A stored value, made safe: anything that isn't a sane width or a column id is dropped. */
export function readColumnLayout(v: unknown): ColumnLayout {
  if (!v || typeof v !== "object" || Array.isArray(v)) return EMPTY;
  const { widths: rawW, hidden: rawH } = v as { widths?: unknown; hidden?: unknown };
  const widths: Record<string, number> = {};
  if (rawW && typeof rawW === "object" && !Array.isArray(rawW))
    for (const [id, w] of Object.entries(rawW)) if (typeof w === "number" && Number.isFinite(w)) widths[id] = clampWidth(w);
  const hidden = Array.isArray(rawH) ? [...new Set(rawH.filter((h): h is string => typeof h === "string"))] : [];
  return { widths, hidden };
}

/**
 * The value to store for `layout`, keeping only the list's current `ids`
 * (the first can't be hidden). Null when nothing is left: remove the key.
 */
export function storedColumnLayout(layout: ColumnLayout, ids: string[]): Partial<ColumnLayout> | null {
  const widths: Record<string, number> = {};
  for (const id of ids) if (layout.widths[id] !== undefined) widths[id] = layout.widths[id];
  const hidden = ids.slice(1).filter((id) => layout.hidden.includes(id));
  if (!Object.keys(widths).length && !hidden.length) return null;
  return hidden.length ? { widths, hidden } : { widths };
}

/** The columns to show: the first always, the rest unless hidden. */
export function visibleColumns<C extends { id: string }>(columns: C[], layout: ColumnLayout): C[] {
  return columns.filter((c, i) => i === 0 || !layout.hidden.includes(c.id));
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

/** Whether any list or table has changed columns (saved, or changed in this window). */
export function anyColumnLayouts(stored: Record<string, unknown>): boolean {
  if (Object.keys(stored).some((k) => k.startsWith(COLUMNS_PREFIX))) return true;
  return Object.entries(layouts).some(([k, l]) => !k.startsWith("local:") && (Object.keys(l.widths).length > 0 || l.hidden.length > 0));
}

/**
 * Settings › Reset all column layouts: every list and table back to its
 * default widths and columns, now and in settings. `stored` is the settings
 * values, for layouts saved by another window that this one never loaded.
 * Returns the settings after the last removal (null if there was nothing).
 */
export async function resetAllColumnLayouts(stored: Record<string, unknown>): Promise<Settings | null> {
  const keys = new Set(Object.keys(stored).filter((k) => k.startsWith(COLUMNS_PREFIX)));
  for (const k of Object.keys(layouts)) if (!k.startsWith("local:")) keys.add(COLUMNS_PREFIX + k);
  layouts = {};
  notify();
  let last: Settings | null = null;
  for (const k of keys) last = await appApi.setValue(k, null);
  return last;
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

  /** Sets several widths at once (a table freezing its auto widths); `persist` as for setWidth. */
  const setWidths = useCallback(
    (widths: Record<string, number>, persist = true) => {
      const cur = layouts[k] ?? EMPTY;
      const next = { ...cur.widths };
      for (const [id, w] of Object.entries(widths)) next[id] = clampWidth(w);
      put(k, { ...cur, widths: next }, idsKey.split("\n"), persist, key !== undefined);
    },
    [k, key, idsKey],
  );

  /** Shows or hides one column (never the first). */
  const toggleHidden = useCallback(
    (id: string) => {
      const ids = idsKey.split("\n");
      if (id === ids[0]) return;
      const cur = layouts[k] ?? EMPTY;
      const hidden = cur.hidden.includes(id) ? cur.hidden.filter((h) => h !== id) : [...cur.hidden, id];
      put(k, { ...cur, hidden }, ids, true, key !== undefined);
    },
    [k, key, idsKey],
  );

  /** Default widths; hidden columns stay hidden. */
  const resetWidths = useCallback(() => {
    const cur = layouts[k] ?? EMPTY;
    put(k, { ...cur, widths: {} }, idsKey.split("\n"), true, key !== undefined);
  }, [k, key, idsKey]);

  /** Default widths and every column shown. */
  const resetAll = useCallback(() => put(k, EMPTY, [], true, key !== undefined), [k, key]);

  return {
    layout,
    setWidth,
    setWidths,
    toggleHidden,
    resetWidths,
    resetAll,
    hasWidths: Object.keys(layout.widths).length > 0,
    hasHidden: layout.hidden.length > 0,
  };
}
