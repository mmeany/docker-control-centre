// What's restored on the next run: open tabs (as addresses), view mode per
// place, and whether the details pane is open. Stored in settings `values`.
import type { ViewMode } from "../components/FileList";
import { parseAddress, type Place } from "../shell/places";

export const SESSION_KEY = "app.session";
export const VIEWS_KEY = "app.views";
export const DETAILS_PANE_KEY = "app.detailsPane";

/** Places remembered with a view; the oldest are dropped beyond this. */
export const MAX_VIEWS = 200;

export interface SavedSession {
  tabs: string[];
  active: number;
}

/** Tabs back from settings; addresses that no longer parse are dropped. */
export function readSession(v: unknown): { places: Place[]; active: number } | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Partial<SavedSession>;
  if (!Array.isArray(s.tabs)) return null;
  let active = typeof s.active === "number" ? s.active : 0;
  const places: Place[] = [];
  s.tabs.forEach((t, i) => {
    const p = typeof t === "string" ? parseAddress(t) : null;
    if (p) places.push(p);
    else if (i < active) active--;
  });
  if (places.length === 0) return null;
  return { places, active: Math.min(Math.max(active, 0), places.length - 1) };
}

const MODES: ViewMode[] = ["details", "list", "tiles"];

export function readViews(v: unknown): Record<string, ViewMode> {
  if (!v || typeof v !== "object") return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, m]) => MODES.includes(m as ViewMode))) as Record<
    string,
    ViewMode
  >;
}

/** Sets a place's view, most recent last; details (the default) isn't stored. */
export function withView(views: Record<string, ViewMode>, uri: string, mode: ViewMode): Record<string, ViewMode> {
  const rest = Object.entries(views).filter(([k]) => k !== uri);
  if (mode !== "details") rest.push([uri, mode]);
  return Object.fromEntries(rest.slice(-MAX_VIEWS));
}
