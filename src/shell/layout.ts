// Which layout the main window uses: Explorer (tree, tabs, address bar) or the
// dashboard (side nav, cards). Saved app-wide in settings values.

export type Layout = "explorer" | "dashboard";

export const LAYOUT_KEY = "app.layout";

export const LAYOUTS: { id: Layout; label: string; title: string }[] = [
  { id: "explorer", label: "Explorer", title: "Tree, tabs and an address bar, like File Explorer" },
  { id: "dashboard", label: "Dashboard", title: "Side navigation, an overview and cards" },
];

/** The saved layout; anything unknown is Explorer. */
export function readLayout(v: unknown): Layout {
  return v === "dashboard" ? "dashboard" : "explorer";
}
