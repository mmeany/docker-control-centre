// Which container actions apply to which states, and how to describe them
// (unit-tested in actions.test.ts).
import type { ContainerItem, ContainerState } from "../../api/engine";

export type Verb = "start" | "stop" | "restart" | "pause" | "unpause" | "kill" | "remove";

const ACTIVE: ContainerState[] = ["running", "paused", "restarting"];

export const VERBS: Record<Verb, { label: string; doing: string; done: string; applies: (s: ContainerState) => boolean }> = {
  start: { label: "Start", doing: "Starting", done: "Started", applies: (s) => !ACTIVE.includes(s) && s !== "removing" && s !== "dead" },
  stop: { label: "Stop", doing: "Stopping", done: "Stopped", applies: (s) => ACTIVE.includes(s) },
  restart: { label: "Restart", doing: "Restarting", done: "Restarted", applies: (s) => s !== "removing" && s !== "dead" },
  pause: { label: "Pause", doing: "Pausing", done: "Paused", applies: (s) => s === "running" },
  unpause: { label: "Resume", doing: "Resuming", done: "Resumed", applies: (s) => s === "paused" },
  kill: { label: "Kill", doing: "Killing", done: "Killed", applies: (s) => ACTIVE.includes(s) },
  remove: { label: "Delete", doing: "Deleting", done: "Deleted", applies: (s) => s !== "removing" },
};

export const applicable = (verb: Verb, items: ContainerItem[]) => items.filter((c) => VERBS[verb].applies(c.state));

const count = (n: number) => `${n.toLocaleString()} container${n === 1 ? "" : "s"}`;

/** "Stopping 2 containers…" */
export const working = (verb: Verb, n: number) => `${VERBS[verb].doing} ${count(n)}…`;

/** "Stopped 2 containers", "Stopped 1 container; 1 failed". */
export function summary(verb: Verb, ok: number, failed: number): string {
  if (ok === 0) return `Couldn't ${VERBS[verb].label.toLowerCase()} ${count(failed)}`;
  return `${VERBS[verb].done} ${count(ok)}${failed ? `; ${failed.toLocaleString()} failed` : ""}`;
}
