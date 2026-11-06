import { describe, expect, it } from "vitest";
import type { ContainerItem } from "../api/engine";
import type { ImageItem, NetworkItem, VolumeItem } from "../api/resources";
import { attention, containerStatus, imageStatus, liveProjects, networkStatus, projectStatus, STATES, volumeStatus } from "./status";

const c = (state: string, extra: Partial<ContainerItem> = {}) =>
  ({ name: `c-${state}`, state, exitCode: null, health: "", status: "", imageId: "img", volumes: [], networks: [], project: null, ...extra }) as ContainerItem;

describe("container status", () => {
  it("tells crashes from clean stops", () => {
    expect(containerStatus(c("exited", { exitCode: 0 })).state).toBe("stopped");
    expect(containerStatus(c("exited", { exitCode: 1 })).state).toBe("error");
    const killed = containerStatus(c("exited", { exitCode: 137 }));
    expect([killed.state, killed.label]).toEqual(["error", "Exit 137"]);
    expect(killed.reason).toContain("out of memory");
    expect(containerStatus(c("dead")).state).toBe("error");
    expect(containerStatus(c("created")).state).toBe("stopped");
  });

  it("uses the health check", () => {
    expect(containerStatus(c("running")).state).toBe("running");
    expect(containerStatus(c("running", { health: "healthy" })).state).toBe("running");
    expect(containerStatus(c("running", { health: "starting" })).state).toBe("starting");
    expect(containerStatus(c("running", { health: "unhealthy" })).state).toBe("error");
    expect(containerStatus(c("paused")).state).toBe("paused");
    expect(containerStatus(c("restarting")).state).toBe("restarting");
  });
});

describe("project roll-up", () => {
  it("red wins, then all / some / none running", () => {
    expect(projectStatus([c("running"), c("exited", { exitCode: 2 })], false).state).toBe("error");
    expect(projectStatus([c("running"), c("running", { health: "starting" })], false).state).toBe("running");
    const some = projectStatus([c("running"), c("exited", { exitCode: 0 })], false);
    expect([some.state, some.label]).toEqual(["partial", "1 of 2 running"]);
    expect(projectStatus([c("exited", { exitCode: 0 }), c("created")], false).state).toBe("stopped");
    expect(projectStatus([], true)).toMatchObject({ state: "down", reason: expect.stringContaining("Pinned") });
  });
});

describe("images, volumes, networks", () => {
  const running = c("running", { name: "web", imageId: "sha256:a", volumes: ["data"], networks: ["shop_default"], project: "shop" });
  const stopped = c("exited", { name: "old", exitCode: 0, imageId: "sha256:b", volumes: ["cache"], networks: ["side"] });
  const all = [running, stopped];
  const live = liveProjects(all, ["blog"]);

  it("images", () => {
    const img = (id: string, tags: string[] = ["x:1"]) => ({ id, tags }) as ImageItem;
    expect(imageStatus(img("sha256:a"), all).state).toBe("running");
    expect(imageStatus(img("sha256:b"), all).state).toBe("idle");
    expect(imageStatus(img("sha256:c"), all).state).toBe("unused");
    expect(imageStatus(img("sha256:d", []), all).state).toBe("orphaned");
    expect(imageStatus(img("sha256:a"), all).reason).toContain("web");
  });

  it("volumes: a pinned project's volume is kept, a gone project's is orphaned", () => {
    const vol = (name: string, extra: Partial<VolumeItem> = {}) => ({ name, anonymous: false, project: null, ...extra }) as VolumeItem;
    expect(volumeStatus(vol("data"), all, live).state).toBe("running");
    expect(volumeStatus(vol("cache"), all, live).state).toBe("idle");
    expect(volumeStatus(vol("named"), all, live).state).toBe("unused");
    expect(volumeStatus(vol("f".repeat(64), { anonymous: true }), all, live).state).toBe("orphaned");
    expect(volumeStatus(vol("blog_db", { project: "blog" }), all, live).state).toBe("unused");
    expect(volumeStatus(vol("gone_db", { project: "gone" }), all, live).state).toBe("orphaned");
    expect(volumeStatus(vol("shop_x", { project: "shop" }), all, live).state).toBe("unused");
  });

  it("networks: Docker's own are never orphaned", () => {
    const net = (name: string, extra: Partial<NetworkItem> = {}) => ({ name, builtin: false, project: null, ...extra }) as NetworkItem;
    expect(networkStatus(net("shop_default", { project: "shop" }), all, live).state).toBe("running");
    expect(networkStatus(net("side"), all, live).state).toBe("idle");
    expect(networkStatus(net("bridge", { builtin: true }), all, live).state).toBe("unused");
    expect(networkStatus(net("gone_default", { project: "gone" }), all, live).state).toBe("orphaned");
    expect(networkStatus(net("mine"), all, live).state).toBe("unused");
    expect(networkStatus(net("shop_default", { project: "shop" }), all, live).reason).toMatch(/^Attached to 1 running container: web/);
  });

  it("counts what needs attention", () => {
    expect(attention([containerStatus(c("dead")), imageStatus({ id: "z", tags: [] } as unknown as ImageItem, all), containerStatus(c("running"))])).toEqual({ errors: 1, orphans: 1 });
  });

  it("the legend covers every state once", () => {
    expect(new Set(STATES.map((s) => s.state)).size).toBe(STATES.length);
    expect(STATES).toHaveLength(11);
  });
});
