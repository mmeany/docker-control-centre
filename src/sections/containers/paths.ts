// Paths inside the Containers section (unit-tested in paths.test.ts):
//
//   ""                     all projects and standalone containers
//   "@shop"                compose project "shop"
//   "@shop/web-1"          container web-1 (in project shop)
//   "web-1"                standalone container
//   "@shop/web-1/logs"     a container's child (logs, env, …)
//   "web-1/files/etc/x"    the files child can go deeper
//
// Container names start with [a-zA-Z0-9], so the "@" can't clash with one.

export type ChildId = "logs" | "terminal" | "stats" | "files" | "env" | "mounts" | "ports" | "networks" | "labels";

export const CHILDREN: { id: ChildId; name: string; description: string }[] = [
  { id: "logs", name: "Logs", description: "Output from the container, live" },
  { id: "terminal", name: "Terminal", description: "A shell inside the container" },
  { id: "stats", name: "Stats", description: "CPU, memory, network and disk use, live" },
  { id: "files", name: "Files", description: "The container's file system" },
  { id: "env", name: "Environment", description: "Environment variables" },
  { id: "mounts", name: "Mounts", description: "Volumes and bind mounts" },
  { id: "ports", name: "Ports", description: "Published and exposed ports" },
  { id: "networks", name: "Networks", description: "Networks the container is on" },
  { id: "labels", name: "Labels", description: "Labels on the container" },
];

export type ContainersLoc =
  | { kind: "root" }
  | { kind: "project"; project: string }
  | { kind: "container"; project: string | null; name: string }
  | { kind: "child"; project: string | null; name: string; child: ChildId; rest: string };

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const PROJECT = /^[a-z0-9][a-z0-9_-]*$/;

export function parseContainers(path: string): ContainersLoc | null {
  const segs = path.split("/").filter((s) => s !== "");
  if (segs.length === 0) return { kind: "root" };
  let project: string | null = null;
  if (segs[0].startsWith("@")) {
    project = segs.shift()!.slice(1);
    if (!PROJECT.test(project)) return null;
    if (segs.length === 0) return { kind: "project", project };
  }
  const name = segs.shift()!;
  if (!NAME.test(name)) return null;
  if (segs.length === 0) return { kind: "container", project, name };
  const child = segs.shift() as ChildId;
  if (!CHILDREN.some((c) => c.id === child)) return null;
  if (segs.length > 0 && child !== "files") return null;
  return { kind: "child", project, name, child, rest: segs.join("/") };
}

export function formatContainers(loc: ContainersLoc): string {
  switch (loc.kind) {
    case "root":
      return "";
    case "project":
      return `@${loc.project}`;
    case "container":
      return [loc.project && `@${loc.project}`, loc.name].filter(Boolean).join("/");
    case "child":
      return [loc.project && `@${loc.project}`, loc.name, loc.child, loc.rest].filter(Boolean).join("/");
  }
}

export const projectPath = (project: string) => formatContainers({ kind: "project", project });
export const containerPath = (project: string | null, name: string) => formatContainers({ kind: "container", project, name });

/** Address-bar segments below "Containers". */
export function containersCrumbs(path: string): { label: string; path: string }[] {
  const loc = parseContainers(path);
  if (!loc || loc.kind === "root") return [];
  const out: { label: string; path: string }[] = [];
  const project = loc.kind === "project" ? loc.project : loc.project;
  if (project) out.push({ label: project, path: projectPath(project) });
  if (loc.kind === "project") return out;
  out.push({ label: loc.name, path: containerPath(loc.project, loc.name) });
  if (loc.kind === "child") {
    const base = { kind: "child" as const, project: loc.project, name: loc.name, child: loc.child };
    out.push({ label: CHILDREN.find((c) => c.id === loc.child)!.name, path: formatContainers({ ...base, rest: "" }) });
    const parts = loc.rest.split("/").filter(Boolean);
    parts.forEach((p, i) => out.push({ label: p, path: formatContainers({ ...base, rest: parts.slice(0, i + 1).join("/") }) }));
  }
  return out;
}

/** One level up (null = the section root). */
export function containersParent(path: string): string | null {
  const crumbs = containersCrumbs(path);
  return crumbs.length >= 2 ? crumbs[crumbs.length - 2].path : null;
}

export const isContainersPath = (path: string) => parseContainers(path) !== null;
