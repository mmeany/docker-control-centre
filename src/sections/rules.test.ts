import { describe, expect, it } from "vitest";
import type { ContainerItem } from "../api/engine";
import type { ImageItem, NetworkItem, VolumeItem } from "../api/resources";
import { flatPaths, imageName, imageRefs, IMAGE_KEY, shortId, unusedImages, unusedNetworks, unusedVolumes } from "./rules";

const c = (imageId: string, volumes: string[] = [], networks: string[] = []) => ({ imageId, volumes, networks }) as ContainerItem;
const img = (id: string, tags: string[] = []) => ({ id, tags, size: 10 }) as ImageItem;
const vol = (name: string, anonymous = false) => ({ name, anonymous }) as VolumeItem;
const net = (name: string, builtin = false) => ({ name, builtin }) as NetworkItem;
const ids = (xs: { id?: string; name?: string }[]) => xs.map((x) => x.id ?? x.name);

describe("prune candidates", () => {
  const containers = [c("sha256:used", ["data"], ["shop_default"])];

  it("images: never one a container uses, even a stopped one", () => {
    const images = [img("sha256:used", ["web:1"]), img("sha256:dangling"), img("sha256:tagged", ["old:1"])];
    expect(ids(unusedImages(images, containers, true))).toEqual(["sha256:dangling"]);
    expect(ids(unusedImages(images, containers, false))).toEqual(["sha256:dangling", "sha256:tagged"]);
  });

  it("volumes: anonymous only by default", () => {
    const volumes = [vol("data"), vol("a".repeat(64), true), vol("old_named")];
    expect(ids(unusedVolumes(volumes, containers, true))).toEqual(["a".repeat(64)]);
    expect(ids(unusedVolumes(volumes, containers, false))).toEqual(["a".repeat(64), "old_named"]);
  });

  it("networks: never the built-in ones", () => {
    const networks = [net("bridge", true), net("host", true), net("shop_default"), net("old_default")];
    expect(ids(unusedNetworks(networks, containers))).toEqual(["old_default"]);
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
