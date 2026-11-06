import { describe, expect, it } from "vitest";
import { containersCrumbs, containersParent, formatContainers, parseContainers } from "./paths";

describe("container paths", () => {
  it("round-trips every kind", () => {
    for (const p of ["", "@shop", "@shop/web-1", "web-1", "@shop/web-1/logs", "web-1/env", "web-1/files/etc/nginx"]) {
      const loc = parseContainers(p);
      expect(loc, p).not.toBeNull();
      expect(formatContainers(loc!)).toBe(p);
    }
  });

  it("parses the parts", () => {
    expect(parseContainers("@shop/web-1/logs")).toEqual({ kind: "child", project: "shop", name: "web-1", child: "logs", rest: "" });
    expect(parseContainers("web-1")).toEqual({ kind: "container", project: null, name: "web-1" });
    expect(parseContainers("/@shop/")).toEqual({ kind: "project", project: "shop" });
  });

  it("rejects what can't be a path", () => {
    expect(parseContainers("@Shop")).toBeNull();
    expect(parseContainers("-bad")).toBeNull();
    expect(parseContainers("web-1/nope")).toBeNull();
    expect(parseContainers("web-1/logs/extra")).toBeNull();
  });

  it("builds crumbs and parents", () => {
    expect(containersCrumbs("@shop/web-1/files/etc/nginx").map((c) => c.label)).toEqual(["shop", "web-1", "Files", "etc", "nginx"]);
    expect(containersCrumbs("@shop/web-1/files/etc").at(-1)!.path).toBe("@shop/web-1/files/etc");
    expect(containersParent("@shop/web-1/logs")).toBe("@shop/web-1");
    expect(containersParent("@shop/web-1")).toBe("@shop");
    expect(containersParent("@shop")).toBeNull();
    expect(containersParent("web-1")).toBeNull();
  });
});
