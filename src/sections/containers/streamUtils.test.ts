import { describe, expect, it } from "vitest";
import type { LogLine, StatsSample } from "../../api/streams";
import { appendLines, findMatches, highlight, mergeByTime, rangeQuery, rates, sparkline, timeKey } from "./streamUtils";

const line = (text: string): LogLine => ({ err: false, time: "", text });

describe("log helpers", () => {
  it("builds queries for each range", () => {
    const now = 1_000_000;
    expect(rangeQuery("tail", now, { from: "", to: "" })).toEqual({ follow: true, tail: 1000 });
    expect(rangeQuery("1h", now, { from: "", to: "" })).toEqual({ follow: true, since: now - 3600 });
    expect(rangeQuery("all", now, { from: "", to: "" })).toEqual({ follow: true });
    const custom = rangeQuery("custom", now, { from: "2026-11-06T10:00", to: "2026-11-06T11:00" });
    expect(custom.follow).toBe(false);
    expect(custom.until! - custom.since!).toBe(3600);
    expect(rangeQuery("custom", now, { from: "2026-11-06T10:00", to: "" }).follow).toBe(true);
  });

  it("caps the buffer", () => {
    const r = appendLines([line("a"), line("b")], [line("c"), line("d")], 3);
    expect(r.lines.map((l) => l.text)).toEqual(["b", "c", "d"]);
    expect(r.dropped).toBe(1);
  });

  it("finds and highlights matches, ignoring case", () => {
    expect(findMatches([line("Error one"), line("fine"), line("another ERROR")], "error")).toEqual([0, 2]);
    expect(findMatches([line("x")], "")).toEqual([]);
    expect(highlight("an Error and error", "error")).toEqual([
      { text: "an ", hit: false },
      { text: "Error", hit: true },
      { text: " and ", hit: false },
      { text: "error", hit: true },
    ]);
  });
});

describe("stats helpers", () => {
  const s = (time: string, n: number): StatsSample => ({
    time,
    cpuPercent: 0,
    onlineCpus: 1,
    memUsed: 0,
    memLimit: 0,
    netRx: n,
    netTx: n * 2,
    blockRead: n,
    blockWrite: 0,
    pids: 1,
  });

  it("turns counters into rates", () => {
    expect(rates(s("2026-11-06T17:00:00Z", 1000), s("2026-11-06T17:00:02Z", 3000))).toEqual({ netRx: 1000, netTx: 2000, blockRead: 1000, blockWrite: 0 });
    // A restart resets counters: no negative rates.
    expect(rates(s("2026-11-06T17:00:00Z", 3000), s("2026-11-06T17:00:01Z", 10)).netRx).toBe(0);
  });

  it("draws sparklines inside the box", () => {
    expect(sparkline([0, 50, 100], 100, 20)).toBe("0.0,19.0 50.0,10.0 100.0,1.0");
    expect(sparkline([], 10, 10)).toBe("");
  });
});

describe("merged logs", () => {
  const l = (time: string, text: string) => ({ err: false, time, text });
  it("orders times with fractions of any length", () => {
    expect(timeKey("2026-11-06T17:04:19.1Z") < timeKey("2026-11-06T17:04:19.12Z")).toBe(true);
    expect(timeKey("2026-11-06T17:04:19Z") < timeKey("2026-11-06T17:04:19.000000001Z")).toBe(true);
  });

  it("merges batches from several containers in time order", () => {
    let lines = mergeByTime([], [l("2026-01-01T00:00:01Z", "a1"), l("2026-01-01T00:00:03Z", "a3")]);
    lines = mergeByTime(lines, [l("2026-01-01T00:00:02.5Z", "b2"), l("2026-01-01T00:00:04Z", "b4"), l("2026-01-01T00:00:00Z", "b0")]);
    expect(lines.map((x) => x.text)).toEqual(["b0", "a1", "b2", "a3", "b4"]);
  });
});
