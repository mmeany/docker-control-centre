// Anonymous volumes: how to name one for people (who mounts it, where) and
// why Docker made it. Unit-tested in anonymous.test.ts.
import type { AnonymousCause, ContainerItem } from "../../api/engine";
import type { VolumeItem } from "../../api/resources";

/** Short cause, for a table cell. */
export const CAUSE_TEXT: Record<AnonymousCause, string> = {
  image: "Image VOLUME",
  noSource: "Created without a name",
  unknown: "Anonymous",
};

/** What each cause means, for a tooltip or a note. */
export const CAUSE_NOTE: Record<AnonymousCause, string> = {
  image: "The image declares this path as a VOLUME and nothing is mounted there, so Docker made a volume with no name.",
  noSource: "A volume was asked for at this path without a name (docker run -v /path, or - /path in a compose file).",
  unknown: "Docker made this volume with no name. The image couldn't be read to say why.",
};

/** How many anonymous volumes these containers hold. */
export const anonymousCount = (containers: ContainerItem[]) =>
  containers.reduce((n, c) => n + c.volumeMounts.filter((m) => /^[0-9a-f]{64}$/.test(m.name)).length, 0);

/** The start of a hash name. */
export const shortHash = (name: string) => (name.length > 20 ? `${name.slice(0, 12)}…` : name);

/** Where containers mount a volume: `shop-db-1:/var/lib/postgresql/data`, first by container name. */
export function mountedAt(containers: ContainerItem[], name: string): string[] {
  return containers
    .flatMap((c) => c.volumeMounts.filter((m) => m.name === name).map((m) => `${c.name}:${m.destination}`))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * A volume's display name. Named volumes are themselves; an anonymous one is
 * named by who mounts it (`shop-db-1:/data (anonymous)`, `+ n` for more), or
 * by the start of its hash when nothing does.
 */
export function volumeLabel(v: VolumeItem, containers: ContainerItem[]): string {
  if (!v.anonymous) return v.name;
  const at = mountedAt(containers, v.name);
  if (at.length === 0) return `${shortHash(v.name)} (anonymous)`;
  return `${at[0]}${at.length > 1 ? ` + ${at.length - 1}` : ""} (anonymous)`;
}
