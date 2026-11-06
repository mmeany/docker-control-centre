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

/** Copyable address for the place ("" if none). */
export function placeUri(p: Place): string {
  const s = sectionOf(p);
  return s ? (s.uri?.(p.path) ?? p.path) : "";
}
