// Path helpers for the sample section. Paths are the OS's own (C:\a\b or /a/b).

export const sepOf = (path: string) => (path.includes("\\") ? "\\" : "/");

/** Each folder from the drive / root down to `path`. */
export function pathChain(path: string): { label: string; path: string }[] {
  if (!path) return [];
  const sep = sepOf(path);
  const parts = path.split(sep).filter(Boolean);
  const out: { label: string; path: string }[] = [];
  if (sep === "/") {
    out.push({ label: "/", path: "/" });
    let acc = "";
    for (const p of parts) {
      acc += "/" + p;
      out.push({ label: p, path: acc });
    }
  } else {
    let acc = "";
    parts.forEach((p, i) => {
      acc = i === 0 ? `${p}\\` : acc.endsWith("\\") ? acc + p : `${acc}\\${p}`;
      out.push({ label: p, path: acc });
    });
  }
  return out;
}

/** Address-bar crumbs below "Local files". */
export const filesCrumbs = (path: string) => pathChain(path);

/** Parent folder; "" (the section root) above a drive or "/". */
export function filesParent(path: string): string | null {
  const chain = pathChain(path);
  return chain.length > 1 ? chain[chain.length - 2].path : "";
}

/** Last segment of a path. */
export function baseName(path: string): string {
  const chain = pathChain(path);
  return chain.length ? chain[chain.length - 1].label : path;
}

export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}
