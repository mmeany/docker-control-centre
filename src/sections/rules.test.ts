import { describe, expect, it } from "vitest";
import type { ContainerItem } from "../api/engine";
import type { ImageItem, NetworkItem, VolumeItem } from "../api/resources";
import { flatPaths, imageName, imageRefs, IMAGE_KEY, orphanedImages, orphanedNetworks, orphanedVolumes, shortId, unusedImages, unusedNetworks, unusedVolumes } from "./rules";

const c = (imageId: string, volumes: string[] = [], networks: string[] = []) => ({ imageId, volumes, networks, state: "running", project: null }) as unknown as ContainerItem;
const img = (id: string, tags: string[] = []) => ({ id, tags, size: 10 }) as ImageItem;
const vol = (name: string, anonymous = false) => ({ name, anonymous, project: null }) as VolumeItem;
const net = (name: string, builtin = false) => ({ name, builtin, project: null }) as NetworkItem;
const ids = (xs: { id?: string; name?: string }[]) => xs.map((x) => x.id ?? x.name);

describe("prune candidates", () => {
  const containers = [c("sha256:used", ["data"], ["shop_default"])];
  const live = new Set(["shop"]);

  it("images: never one a container uses, even a stopped one", () => {
    const images = [img("sha256:used", ["web:1"]), img("sha256:dangling"), img("sha256:tagged", ["old:1"])];
    expect(ids(orphanedImages(images, containers))).toEqual(["sha256:dangling"]);
    expect(ids(unusedImages(images, containers))).toEqual(["sha256:dangling", "sha256:tagged"]);
  });

  it("volumes: orphaned means anonymous, or from a project that's gone", () => {
    const volumes = [vol("data"), vol("a".repeat(64), true), vol("old_named"), { ...vol("gone_db"), project: "gone" } as VolumeItem];
    expect(ids(orphanedVolumes(volumes, containers, live))).toEqual(["a".repeat(64), "gone_db"]);
    expect(ids(unusedVolumes(volumes, containers, live))).toEqual(["a".repeat(64), "old_named", "gone_db"]);
  });

  it("networks: never the built-in ones", () => {
    const networks = [net("bridge", true), net("host", true), net("shop_default"), net("old_default"), { ...net("gone_default"), project: "gone" } as NetworkItem];
    expect(ids(unusedNetworks(networks, containers, live))).toEqual(["old_default", "gone_default"]);
    expect(ids(orphanedNetworks(networks, containers, live))).toEqual(["gone_default"]);
  });
});

describe("images", () => {
  it("names and references", () => {
    expect(shortId("sha256:0123456789abcdef")).toBe("0123456789ab");
    expect(imageName(img("sha256:0123456789abcdef"))).toBe("<none> (0123456789ab)");
    expect(imageRefs(img("sha256:x", ["a:1", "a:2"]))).toEqual(["a:1", "a:2"]);
    expect(imageRefs(img("sha256:x"))).toEqual(["sha256:x"]);
  });

  it("one-level paths", () => {
    const p = flatPaths((s) => IMAGE_KEY.test(s));
    expect(p.isPath("0123456789ab")).toBe(true);
    expect(p.isPath("nginx")).toBe(false);
    expect(p.crumbs("0123456789ab")).toEqual([{ label: "0123456789ab", path: "0123456789ab" }]);
  });
});
