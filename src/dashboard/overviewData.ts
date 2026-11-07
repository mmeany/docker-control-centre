// What the dashboard overview shows, worked out from data the app already has
// (containers, the totals stream, section attention). Pure, unit-tested in
// overviewData.test.ts.
import type { ContainerItem } from "../api/engine";
import type { ContainerFigures, TotalsSnapshot } from "../api/streams";
import { containerStatus, type Status } from "../status/status";

/** Five minutes of totals at one snapshot every 2 s. */
export const HISTORY = 150;

/** One point of the totals history. */
export interface TotalsPoint {
  cpu: number;
  mem: number;
  netRx: number;
  netTx: number;
  blockRead: number;
  blockWrite: number;
}

export function pointOf(s: TotalsSnapshot): TotalsPoint {
  return { cpu: s.cpuPercent, mem: s.memUsed, netRx: s.netRxRate, netTx: s.netTxRate, blockRead: s.blockReadRate, blockWrite: s.blockWriteRate };
}

/** Adds a point, keeping the newest `keep`. */
export function pushPoint(history: TotalsPoint[], p: TotalsPoint, keep = HISTORY): TotalsPoint[] {
  return [...history.slice(-(keep - 1)), p];
}

/** CPU as a share of the whole engine: 400% on 8 CPUs is 50%. */
export function cpuShare(s: Pick<TotalsSnapshot, "cpuPercent" | "onlineCpus">): number {
  return s.onlineCpus > 0 ? s.cpuPercent / s.onlineCpus : 0;
}

/** The top `n` containers by a figure, ignoring ones at zero. */
export function topBy(list: ContainerFigures[], key: "cpuPercent" | "memUsed", n = 5): ContainerFigures[] {
  return list
    .filter((c) => c[key] > 0)
    .sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name))
    .slice(0, n);
}

export interface Problem {
  container: ContainerItem;
  status: Status;
}

/**
 * Containers that need attention: problems (exit codes, dead, unhealthy)
 * and ones Docker keeps restarting. Restarting first, then by name.
 */
export function problemContainers(containers: ContainerItem[]): Problem[] {
  return containers
    .map((container) => ({ container, status: containerStatus(container) }))
    .filter((p) => p.status.state === "error" || p.status.state === "restarting")
    .sort((a, b) => Number(b.status.state === "restarting") - Number(a.status.state === "restarting") || a.container.name.localeCompare(b.container.name));
}

/** "Waiting", "3 containers", "100 of 140 containers (the rest aren't counted)". */
export function countedText(s: TotalsSnapshot | null): string {
  if (!s) return "Waiting for the first figures…";
  const n = (k: number) => `${k.toLocaleString()} container${k === 1 ? "" : "s"}`;
  if (s.skipped > 0) return `${s.counted.toLocaleString()} of ${n(s.counted + s.skipped)}: only the first ${s.counted.toLocaleString()} are counted`;
  return `Across ${n(s.counted)} running`;
}
