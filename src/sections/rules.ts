// What uses what, and what a prune would remove (unit-tested in rules.test.ts).
// The engine has no dry run for prune, so the preview is computed here and
// exactly those items are removed.
import type { ContainerItem } from "../api/engine";
import type { ImageItem, NetworkItem, VolumeItem } from "../api/resources";

export const shortId = (id: string) => id.replace(/^sha256:/, "").slice(0, 12);

export const imageUsers = (containers: ContainerItem[], imageId: string) => containers.filter((c) => c.imageId === imageId);
export const volumeUsers = (containers: ContainerItem[], name: string) => containers.filter((c) => c.volumes.includes(name));
export const networkUsers = (containers: ContainerItem[], name: string) => containers.filter((c) => c.networks.includes(name));

/** An image's display name: its first tag, or its short id. */
export const imageName = (i: ImageItem) => i.tags[0] ?? `<none> (${shortId(i.id)})`;

/** References that remove an image: each tag, or the id when it has none. */
export const imageRefs = (i: ImageItem) => (i.tags.length ? i.tags : [i.id]);

export function unusedImages(images: ImageItem[], containers: ContainerItem[], danglingOnly: boolean): ImageItem[] {
  const used = new Set(containers.map((c) => c.imageId));
  return images.filter((i) => !used.has(i.id) && (!danglingOnly || i.tags.length === 0));
}

export function unusedVolumes(volumes: VolumeItem[], containers: ContainerItem[], anonymousOnly: boolean): VolumeItem[] {
  const used = new Set(containers.flatMap((c) => c.volumes));
  return volumes.filter((v) => !used.has(v.name) && (!anonymousOnly || v.anonymous));
}

export function unusedNetworks(networks: NetworkItem[], containers: ContainerItem[]): NetworkItem[] {
  const used = new Set(containers.flatMap((c) => c.networks));
  return networks.filter((n) => !n.builtin && !used.has(n.name));
}

export const totalSize = (images: ImageItem[]) => images.reduce((t, i) => t + i.size, 0);

/** Paths for a one-level section: "" is the list, "<key>" one item. */
export function flatPaths(isKey: (s: string) => boolean) {
  return {
    crumbs: (path: string) => (path ? [{ label: path, path }] : []),
    parent: () => null,
    isPath: (path: string) => isKey(path),
  };
}

export const IMAGE_KEY = /^[0-9a-f]{12}$/;
/** Volume and network names. */
export const NAME_KEY = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
