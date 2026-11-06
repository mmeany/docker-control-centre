// Pure helpers for the logs and stats views (unit-tested in streamUtils.test.ts).
import type { LogLine, LogQuery, StatsSample } from "../../api/streams";

export type RangeId = "tail" | "15m" | "1h" | "24h" | "all" | "custom";

export const RANGES: { id: RangeId; label: string }[] = [
  { id: "tail", label: "Last 1,000 lines" },
  { id: "15m", label: "Last 15 minutes" },
  { id: "1h", label: "Last hour" },
  { id: "24h", label: "Last 24 hours" },
  { id: "all", label: "Everything" },
  { id: "custom", label: "Custom range…" },
];

export const TAIL_LINES = 1000;
/** Lines kept in memory; older ones are dropped. */
export const MAX_LINES = 50_000;

/** "2026-11-06T17:04" (datetime-local) to unix seconds; null if empty or bad. */
export function localToUnix(v: string): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return isNaN(t) ? null : Math.floor(t / 1000);
}

/** The engine query for a range. Follows unless the range has an end. */
export function rangeQuery(range: RangeId, nowSeconds: number, custom: { from: string; to: string }): LogQuery {
  const ago = (s: number) => ({ follow: true, since: nowSeconds - s });
  switch (range) {
    case "tail":
      return { follow: true, tail: TAIL_LINES };
    case "15m":
      return ago(15 * 60);
    case "1h":
      return ago(3600);
    case "24h":
      return ago(86_400);
    case "all":
      return { follow: true };
    case "custom": {
      const since = localToUnix(custom.from) ?? undefined;
      const until = localToUnix(custom.to) ?? undefined;
      return { follow: until === undefined, since, until };
    }
  }
}

/** Appends lines, keeping at most MAX_LINES; reports how many were dropped. */
export function appendLines(old: LogLine[], more: LogLine[], max = MAX_LINES): { lines: LogLine[]; dropped: number } {
  const all = old.concat(more);
  const dropped = Math.max(0, all.length - max);
  return { lines: dropped ? all.slice(dropped) : all, dropped };
}

/** Indexes of lines containing `q` (case-insensitive). */
export function findMatches(lines: LogLine[], q: string): number[] {
  if (!q) return [];
  const needle = q.toLowerCase();
  const out: number[] = [];
  lines.forEach((l, i) => l.text.toLowerCase().includes(needle) && out.push(i));
  return out;
}

/** Splits text around case-insensitive matches of q, for highlighting. */
export function highlight(text: string, q: string): { text: string; hit: boolean }[] {
  if (!q) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, i + needle.length)) {
    if (i > at) out.push({ text: text.slice(at, i), hit: false });
    out.push({ text: text.slice(i, i + needle.length), hit: true });
    at = i + needle.length;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

/** "17:04:19.123" from an RFC 3339 time, in local time. */
export function shortTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export interface Rates {
  netRx: number;
  netTx: number;
  blockRead: number;
  blockWrite: number;
}

/** Bytes per second between two samples (0 if time didn't move or a counter reset). */
export function rates(a: StatsSample, b: StatsSample): Rates {
  const dt = (new Date(b.time).getTime() - new Date(a.time).getTime()) / 1000;
  const r = (x: number, y: number) => (dt > 0 && y >= x ? (y - x) / dt : 0);
  return { netRx: r(a.netRx, b.netRx), netTx: r(a.netTx, b.netTx), blockRead: r(a.blockRead, b.blockRead), blockWrite: r(a.blockWrite, b.blockWrite) };
}

/** SVG polyline points for values in a w×h box (max at least `floor`). */
export function sparkline(values: number[], w: number, h: number, floor = 1): string {
  if (values.length === 0) return "";
  const max = Math.max(floor, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`).join(" ");
}

/** A sortable key for an RFC 3339 time whose fraction may be any length. */
export function timeKey(t: string): string {
  const m = /^(.*T\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)?$/.exec(t);
  if (!m) return t;
  return `${m[1]}.${(m[2] ?? "").padEnd(9, "0").slice(0, 9)}${m[3] ?? ""}`;
}

/** Merges new lines into lines already in time order (stable for equal times). */
export function mergeByTime<T extends { time: string }>(old: T[], more: T[]): T[] {
  const add = more.map((l, i) => ({ l, k: timeKey(l.time), i })).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i));
  if (add.length === 0) return old;
  const out: T[] = [];
  let i = 0;
  for (const { l, k } of add) {
    while (i < old.length && timeKey(old[i].time) <= k) out.push(old[i++]);
    out.push(l);
  }
  while (i < old.length) out.push(old[i++]);
  return out;
}
