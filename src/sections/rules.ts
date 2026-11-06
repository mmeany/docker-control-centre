// What uses what, and what a prune would remove (unit-tested in rules.test.ts).
// The engine has no dry run for prune, so the preview is computed here and
// exactly those items are removed.
import type { ContainerItem } from "../api/engine";
import type { ImageItem, NetworkItem, VolumeItem } from "../api/resources";
import { imageStatus, networkStatus, volumeStatus, type StatusState } from "../status/status";

export const shortId = (id: string) => id.replace(/^sha256:/, "").slice(0, 12);

export const imageUsers = (containers: ContainerItem[], imageId: string) => containers.filter((c) => c.imageId === imageId);
export const volumeUsers = (containers: ContainerItem[], name: string) => containers.filter((c) => c.volumes.includes(name));
export const networkUsers = (containers: ContainerItem[], name: string) => containers.filter((c) => c.networks.includes(name));

/** An image's display name: its first tag, or its short id. */
export const imageName = (i: ImageItem) => i.tags[0] ?? `<none> (${shortId(i.id)})`;

/** References that remove an image: each tag, or the id when it has none. */
export const imageRefs = (i: ImageItem) => (i.tags.length ? i.tags : [i.id]);

// Prune candidates come from the status model, so the orange marks and what
// "Orphaned only" removes can't disagree.
const gone = (st: StatusState) => st === "unused" || st === "orphaned";

/** Nothing uses them (prune "All unused"). */
export const unusedImages = (images: ImageItem[], containers: ContainerItem[]) => images.filter((i) => gone(imageStatus(i, containers).state));
/** Untagged and unused (prune "Orphaned only"). */
export const orphanedImages = (images: ImageItem[], containers: ContainerItem[]) => images.filter((i) => imageStatus(i, containers).state === "orphaned");

export const unusedVolumes = (volumes: VolumeItem[], containers: ContainerItem[], live: Set<string>) =>
  volumes.filter((v) => gone(volumeStatus(v, containers, live).state));
/** Anonymous, or left by a compose project that's gone. */
export const orphanedVolumes = (volumes: VolumeItem[], containers: ContainerItem[], live: Set<string>) =>
  volumes.filter((v) => volumeStatus(v, containers, live).state === "orphaned");

/** Never Docker's own networks. */
export const unusedNetworks = (networks: NetworkItem[], containers: ContainerItem[], live: Set<string>) =>
  networks.filter((n) => !n.builtin && gone(networkStatus(n, containers, live).state));
export const orphanedNetworks = (networks: NetworkItem[], containers: ContainerItem[], live: Set<string>) =>
  networks.filter((n) => networkStatus(n, containers, live).state === "orphaned");

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
