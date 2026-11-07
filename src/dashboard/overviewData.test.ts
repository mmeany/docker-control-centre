import { describe, expect, it } from "vitest";
import type { ContainerItem } from "../api/engine";
import type { ContainerFigures, TotalsSnapshot } from "../api/streams";
import { countedText, cpuShare, problemContainers, pushPoint, topBy, type TotalsPoint } from "./overviewData";

const fig = (name: string, cpuPercent: number, memUsed: number): ContainerFigures => ({
  id: name,
  name,
  cpuPercent,
  memUsed,
  memLimit: 0,
  netRxRate: 0,
  netTxRate: 0,
  blockReadRate: 0,
  blockWriteRate: 0,
});

const snap = (counted: number, skipped: number): TotalsSnapshot => ({
  cpuPercent: 0,
  onlineCpus: 8,
  memUsed: 0,
  memLimit: 0,
  netRxRate: 0,
  netTxRate: 0,
  blockReadRate: 0,
  blockWriteRate: 0,
  counted,
  skipped,
  containers: [],
});

const c = (name: string, state: ContainerItem["state"], extra: Partial<ContainerItem> = {}) =>
  ({ id: name, name, state, status: "", exitCode: null, health: null, ...extra }) as ContainerItem;

describe("overview", () => {
  it("keeps the newest history points", () => {
    let h: TotalsPoint[] = [];
    for (let i = 0; i < 5; i++) h = pushPoint(h, { cpu: i, mem: 0, netRx: 0, netTx: 0, blockRead: 0, blockWrite: 0 }, 3);
    expect(h.map((p) => p.cpu)).toEqual([2, 3, 4]);
  });

  it("shares CPU across the engine", () => {
    expect(cpuShare({ cpuPercent: 400, onlineCpus: 8 })).toBe(50);
    expect(cpuShare({ cpuPercent: 10, onlineCpus: 0 })).toBe(0);
  });

  it("picks the top consumers, skipping idle ones", () => {
    const list = [fig("a", 5, 10), fig("b", 50, 5), fig("c", 0, 99), fig("d", 5, 0)];
    expect(topBy(list, "cpuPercent").map((x) => x.name)).toEqual(["b", "a", "d"]);
    expect(topBy(list, "memUsed", 2).map((x) => x.name)).toEqual(["c", "a"]);
  });

  it("lists problem containers, restarting first", () => {
    const list = [
      c("ok", "running"),
      c("zeta", "exited", { exitCode: 1 }),
      c("clean", "exited", { exitCode: 0 }),
      c("sick", "running", { health: "unhealthy" }),
      c("loop", "restarting"),
    ];
    expect(problemContainers(list).map((p) => p.container.name)).toEqual(["loop", "sick", "zeta"]);
  });

  it("says what was counted", () => {
    expect(countedText(null)).toMatch(/Waiting/);
    expect(countedText(snap(1, 0))).toBe("Across 1 container running");
    expect(countedText(snap(100, 40))).toBe("100 of 140 containers: only the first 100 are counted");
  });
});
