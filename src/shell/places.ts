// A "place" is anywhere the main panel can show: Home (the list of sections)
// or a path inside a section. What a path means is up to the section (a
// folder, a record id, "" for its root). History, the address bar and Up work
// on places through the section's crumbs / parent / uri helpers.
import { SECTIONS, type SectionDef } from "../sections";

export interface Place {
  /** null = Home. */
  section: string | null;
  path: string;
}

export const HOME: Place = { section: null, path: "" };

export const sectionOf = (p: Place): SectionDef | undefined => SECTIONS.find((s) => s.id === p.section);

export const rootOf = (s: SectionDef): Place => ({ section: s.id, path: s.root });

export const samePlace = (a: Place, b: Place) => a.section === b.section && a.path === b.path;

/** Address-bar segments after Home. */
export function placeCrumbs(p: Place): { label: string; place: Place }[] {
  const s = sectionOf(p);
  if (!s) return [];
  return [
    { label: s.name, place: rootOf(s) },
    ...(s.crumbs?.(p.path) ?? []).map((c) => ({ label: c.label, place: { section: s.id, path: c.path } })),
  ];
}

/** One level up: inside a section, then its root, then Home. */
export function parentPlace(p: Place): Place | null {
  const s = sectionOf(p);
  if (!s) return null;
  if (p.path === s.root) return HOME;
  const up = s.parent?.(p.path);
  return up === null || up === undefined ? rootOf(s) : { section: s.id, path: up };
}

/** Copyable address for the place: "/" for Home, "/<section>/<path>" below. */
export function placeUri(p: Place): string {
  const s = sectionOf(p);
  if (!s) return "/";
  return s.uri?.(p.path) ?? `/${s.id}${p.path ? `/${p.path}` : ""}`;
}

/**
 * A typed address back to a place: "/containers/@shop/web-1" (leading slash
 * optional; the section may be its id or its name, any case). null if it
 * doesn't lead anywhere.
 */
export function parseAddress(text: string): Place | null {
  const t = text.trim().replace(/\\/g, "/");
  const segs = t.split("/").filter((x) => x !== "");
  if (segs.length === 0) return HOME;
  const head = segs[0].toLowerCase();
  const s = SECTIONS.find((x) => x.id.toLowerCase() === head || x.name.toLowerCase() === head);
  if (!s) return null;
  const path = segs.slice(1).join("/");
  if (path === "") return rootOf(s);
  return (s.isPath?.(path) ?? true) ? { section: s.id, path } : null;
}
