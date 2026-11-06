// Which tree items show at each Show level (unit-tested in filter.test.ts).
// Built on the status states, so the filter and the colours always agree.
import type { Status, StatusState } from "./status";

export type TreeLevel = "running" | "stopped" | "all";

export const TREE_LEVELS: { id: TreeLevel; label: string; title: string }[] = [
  { id: "running", label: "Running", title: "Running containers and projects, anything with a problem, and what running containers use" },
  { id: "stopped", label: "Running and stopped", title: "Adds stopped containers and projects, idle images, volumes and networks, and pinned projects that are down" },
  { id: "all", label: "Everything", title: "Adds unused and orphaned images, volumes and networks" },
];

export const TREE_LEVEL_KEY = "app.treeLevel";

/** The first level each state shows at. */
const SHOWS_FROM: Record<StatusState, number> = {
  running: 0,
  starting: 0,
  paused: 0,
  restarting: 0,
  partial: 0,
  error: 0,
  stopped: 1,
  idle: 1,
  down: 1,
  unused: 2,
  orphaned: 2,
};
const RANK: Record<TreeLevel, number> = { running: 0, stopped: 1, all: 2 };

export const visibleAt = (level: TreeLevel, s: Status) => SHOWS_FROM[s.state] <= RANK[level];

export const readTreeLevel = (v: unknown): TreeLevel => (v === "stopped" || v === "all" ? v : "running");

/** "+ 3 stopped" when it's all one kind, else "+ 5 more". */
export function hiddenSummary(hidden: Status[]): string {
  if (hidden.length === 0) return "";
  const kinds = new Set(hidden.map((s) => s.state));
  const word: Partial<Record<StatusState, string>> = { stopped: "stopped", idle: "idle", down: "down", unused: "unused", orphaned: "orphaned" };
  const only = kinds.size === 1 ? word[[...kinds][0]] : undefined;
  return `+ ${hidden.length.toLocaleString()} ${only ?? "more"}`;
}

/**
 * Splits items into what shows and what's hidden. `keep` always shows (the
 * open item); `level` is the effective level (a revealed branch uses "all").
 */
export function partition<T>(items: T[], statusOf: (t: T) => Status, level: TreeLevel, keep: (t: T) => boolean = () => false) {
  const shown: T[] = [];
  const hidden: T[] = [];
  for (const t of items) (visibleAt(level, statusOf(t)) || keep(t) ? shown : hidden).push(t);
  return { shown, hidden, summary: hiddenSummary(hidden.map(statusOf)) };
}
