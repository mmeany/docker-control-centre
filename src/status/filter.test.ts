import { describe, expect, it } from "vitest";
import { hiddenSummary, partition, readTreeLevel, visibleAt, type TreeLevel } from "./filter";
import type { Status, StatusState } from "./status";

const s = (state: StatusState): Status => ({ state, label: state, reason: "" });
const at = (level: TreeLevel) => (["running", "starting", "paused", "restarting", "partial", "error", "stopped", "idle", "down", "unused", "orphaned"] as StatusState[]).filter((st) => visibleAt(level, s(st)));

describe("tree levels", () => {
  it("Running shows live things and problems", () => {
    expect(at("running")).toEqual(["running", "starting", "paused", "restarting", "partial", "error"]);
  });

  it("Running and stopped adds stopped, idle and down", () => {
    expect(at("stopped")).toEqual([...at("running"), "stopped", "idle", "down"]);
  });

  it("Everything adds unused and orphaned", () => {
    expect(at("all")).toHaveLength(11);
    expect(visibleAt("stopped", s("orphaned"))).toBe(false);
    expect(visibleAt("all", s("orphaned"))).toBe(true);
  });

  it("reads a saved level, defaulting to Running", () => {
    expect(readTreeLevel("all")).toBe("all");
    expect(readTreeLevel("stopped")).toBe("stopped");
    expect(readTreeLevel(undefined)).toBe("running");
    expect(readTreeLevel("bogus")).toBe("running");
  });
});

describe("hidden rows", () => {
  it("names one kind, else says more", () => {
    expect(hiddenSummary([s("stopped"), s("stopped"), s("stopped")])).toBe("+ 3 stopped");
    expect(hiddenSummary([s("orphaned"), s("orphaned")])).toBe("+ 2 orphaned");
    expect(hiddenSummary([s("stopped"), s("idle")])).toBe("+ 2 more");
    expect(hiddenSummary([])).toBe("");
  });

  it("always keeps the open item", () => {
    const items = [
      { k: "a", st: s("running") },
      { k: "b", st: s("stopped") },
      { k: "c", st: s("stopped") },
    ];
    const p = partition(items, (i) => i.st, "running", (i) => i.k === "c");
    expect(p.shown.map((i) => i.k)).toEqual(["a", "c"]);
    expect(p.hidden.map((i) => i.k)).toEqual(["b"]);
    expect(p.summary).toBe("+ 1 stopped");
  });
});
