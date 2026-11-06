// Compose projects from two places: running ones (container labels) and
// pinned compose files (so a project shows while it's down). Unit-tested in
// projects.test.ts.
import type { ComposeTarget, Pinned } from "../../api/compose";
import type { ContainerItem } from "../../api/engine";

export interface Project {
  name: string;
  /** Folder compose runs in (engine-side path for running ones). */
  dir: string;
  files: string[];
  containers: ContainerItem[];
  running: number;
  pinned: Pinned | null;
}

export function projectsFrom(containers: ContainerItem[], pinned: Pinned[]): Project[] {
  const map = new Map<string, Project>();
  for (const c of containers) {
    if (!c.project) continue;
    const p = map.get(c.project) ?? { name: c.project, dir: "", files: [], containers: [], running: 0, pinned: null };
    p.containers.push(c);
    if (c.state === "running") p.running++;
    if (!p.dir && c.workingDir) p.dir = c.workingDir;
    if (p.files.length === 0 && c.configFiles.length) p.files = c.configFiles;
    map.set(c.project, p);
  }
  for (const pin of pinned) {
    const p = map.get(pin.name);
    if (p) p.pinned = pin;
    else map.set(pin.name, { name: pin.name, dir: parentDir(pin.file), files: [pin.file], containers: [], running: 0, pinned: pin });
  }
  for (const p of map.values()) p.containers.sort((a, b) => a.name.localeCompare(b.name));
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function parentDir(file: string): string {
  const i = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
  return i <= 0 ? (i === 0 ? "/" : "") : file.slice(0, i);
}

/**
 * What to run compose against. A pinned file is the user's own choice, so it
 * wins; otherwise the files the project was started from.
 */
export function targetOf(p: Project): ComposeTarget {
  if (p.pinned) return { name: p.name, dir: parentDir(p.pinned.file), files: [p.pinned.file] };
  return { name: p.name, dir: p.dir, files: p.files };
}

/** "Running", "2 of 3 running", "Stopped", "Down". */
export function projectState(p: Project): string {
  if (p.containers.length === 0) return "Down";
  if (p.running === p.containers.length) return "Running";
  if (p.running === 0) return "Stopped";
  return `${p.running} of ${p.containers.length} running`;
}

/** "/mnt/e/x" -> "E:\x"; other WSL paths -> \\wsl.localhost\<distro>\…; others unchanged. */
export function windowsPath(p: string, distro: string): string {
  const m = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(p);
  if (m) return `${m[1].toUpperCase()}:${(m[2] ?? "\\").replace(/\//g, "\\")}`;
  if (p.startsWith("/") && distro) return `\\\\wsl.localhost\\${distro}${p.replace(/\//g, "\\")}`;
  return p;
}

const SERVICE_COLOURS = 8;
/** A stable colour slot (0-7) per service name, for merged logs. */
export function colourOf(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % SERVICE_COLOURS;
}
