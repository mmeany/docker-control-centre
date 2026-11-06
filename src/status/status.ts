// One status model for everything the app shows: a state (which picks the
// colour and mark), a short label, and the reason (the tooltip). Unit-tested
// in status.test.ts; prune candidates are built on it, so what's orange is
// exactly what "Orphaned only" removes.
import type { ContainerItem } from "../api/engine";
import type { ImageItem, NetworkItem, VolumeItem } from "../api/resources";

export type StatusState =
  | "running"
  | "starting"
  | "paused"
  | "restarting"
  | "partial"
  | "error"
  | "idle"
  | "stopped"
  | "unused"
  | "orphaned"
  | "down";

export interface Status {
  state: StatusState;
  label: string;
  /** Why it has this state: shown as the tooltip. */
  reason: string;
}

/** For the legend: every state, in display order. */
export const STATES: { state: StatusState; label: string; meaning: string }[] = [
  { state: "running", label: "Running / in use", meaning: "A running container, or something a running container uses." },
  { state: "starting", label: "Starting", meaning: "Running, but its health check hasn't passed yet." },
  { state: "paused", label: "Paused", meaning: "Paused: still there, not running." },
  { state: "restarting", label: "Restarting", meaning: "Docker is restarting it, usually because it keeps stopping." },
  { state: "partial", label: "Partly running", meaning: "A project where some containers run and some don't." },
  { state: "error", label: "Problem", meaning: "Stopped with an error, dead, or failing its health check. In a project, any one of these." },
  { state: "idle", label: "Idle", meaning: "Only stopped containers use it." },
  { state: "stopped", label: "Stopped", meaning: "A container that stopped cleanly or never started; a project with nothing running." },
  { state: "unused", label: "Unused", meaning: "Nothing uses it, but it's kept on purpose: a tagged image, a named volume, a live project's network, Docker's own networks." },
  { state: "orphaned", label: "Orphaned", meaning: "Nothing uses it and nothing will: safe to prune. An untagged image, an anonymous volume, or something left by a compose project that's gone." },
  { state: "down", label: "Down", meaning: "A pinned compose project with no containers." },
];

const names = (cs: ContainerItem[], max = 3) => {
  const n = cs.map((c) => c.name);
  return n.length > max ? `${n.slice(0, max).join(", ")} and ${n.length - max} more` : n.join(", ");
};
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function containerStatus(c: ContainerItem): Status {
  switch (c.state) {
    case "running":
      if (c.health === "unhealthy") return { state: "error", label: "Unhealthy", reason: "Running, but its health check is failing." };
      if (c.health === "starting") return { state: "starting", label: "Starting", reason: "Running; waiting for its health check to pass." };
      return { state: "running", label: "Running", reason: c.health === "healthy" ? "Running and healthy." : "Running." };
    case "paused":
      return { state: "paused", label: "Paused", reason: "Paused." };
    case "restarting":
      return { state: "restarting", label: "Restarting", reason: "Docker is restarting it (its restart policy brings it back each time it stops)." };
    case "dead":
      return { state: "error", label: "Dead", reason: "Dead: Docker couldn't stop or remove it cleanly." };
    case "exited":
      if (c.exitCode !== null && c.exitCode !== 0) {
        const why = c.exitCode === 137 ? " (killed: docker kill, or out of memory)" : c.exitCode === 143 ? " (terminated)" : "";
        return { state: "error", label: `Exit ${c.exitCode}`, reason: `Stopped with exit code ${c.exitCode}${why}.` };
      }
      return { state: "stopped", label: "Stopped", reason: "Stopped cleanly (exit code 0)." };
    case "created":
      return { state: "stopped", label: "Created", reason: "Created, never started." };
    default:
      return { state: "stopped", label: c.state || "Unknown", reason: c.status || "Not running." };
  }
}

const isUp = (s: StatusState) => s === "running" || s === "starting";

/** A project's state from its containers: red wins, then all / some / none running. */
export function projectStatus(containers: ContainerItem[], pinned: boolean): Status {
  if (containers.length === 0)
    return { state: "down", label: "Down", reason: pinned ? "Pinned; no containers. Up brings it back." : "No containers." };
  const states = containers.map(containerStatus);
  const bad = containers.filter((_, i) => states[i].state === "error");
  if (bad.length) return { state: "error", label: "Problem", reason: `${plural(bad.length, "container")} with a problem: ${names(bad)}.` };
  const up = states.filter((s) => isUp(s.state)).length;
  if (up === containers.length) return { state: "running", label: "Running", reason: `All ${plural(up, "container")} running.` };
  if (up === 0) return { state: "stopped", label: "Stopped", reason: `None of its ${plural(containers.length, "container")} is running.` };
  return { state: "partial", label: `${up} of ${containers.length} running`, reason: `${up} of ${containers.length} containers running.` };
}

/** Running users beat stopped ones. */
function usage(users: ContainerItem[], what: string): Status | null {
  const running = users.filter((c) => c.state === "running" || c.state === "paused" || c.state === "restarting");
  if (running.length) return { state: "running", label: "In use", reason: `${what} by ${plural(running.length, "running container")}: ${names(running)}.` };
  if (users.length) return { state: "idle", label: "Idle", reason: `${what} only by stopped containers: ${names(users)}.` };
  return null;
}

export function imageStatus(i: ImageItem, containers: ContainerItem[]): Status {
  const used = usage(
    containers.filter((c) => c.imageId === i.id),
    "Used",
  );
  if (used) return used;
  if (i.tags.length === 0) return { state: "orphaned", label: "Orphaned", reason: "Untagged, and no container uses it: safe to prune." };
  return { state: "unused", label: "Unused", reason: "Tagged, but no container uses it." };
}

/** Compose projects that still exist: they have containers, or are pinned. */
export function liveProjects(containers: ContainerItem[], pinned: string[]): Set<string> {
  return new Set([...containers.map((c) => c.project).filter((p): p is string => !!p), ...pinned]);
}

export function volumeStatus(v: VolumeItem, containers: ContainerItem[], live: Set<string>): Status {
  const used = usage(
    containers.filter((c) => c.volumes.includes(v.name)),
    "Mounted",
  );
  if (used) return used;
  if (v.anonymous) return { state: "orphaned", label: "Orphaned", reason: "Anonymous, and nothing mounts it: safe to prune." };
  if (v.project && !live.has(v.project))
    return { state: "orphaned", label: "Orphaned", reason: `Left by compose project ${v.project}, which has no containers and isn't pinned.` };
  return { state: "unused", label: "Unused", reason: v.project ? `Nothing mounts it; it belongs to compose project ${v.project}.` : "A named volume nothing mounts." };
}

export function networkStatus(n: NetworkItem, containers: ContainerItem[], live: Set<string>): Status {
  const used = usage(
    containers.filter((c) => c.networks.includes(n.name)),
    "Attached",
  );
  if (used) return { ...used, reason: used.reason.replace(/^Attached by/, "Attached to") };
  if (n.builtin) return { state: "unused", label: "Unused", reason: "Docker's own network: nothing attached." };
  if (n.project && !live.has(n.project))
    return { state: "orphaned", label: "Orphaned", reason: `Left by compose project ${n.project}, which has no containers and isn't pinned.` };
  return { state: "unused", label: "Unused", reason: n.project ? `Nothing attached; it belongs to compose project ${n.project}.` : "Nothing attached." };
}

/** What needs attention in a set of statuses, for the section badges. */
export function attention(statuses: Status[]): { errors: number; orphans: number } {
  return { errors: statuses.filter((s) => s.state === "error").length, orphans: statuses.filter((s) => s.state === "orphaned").length };
}
