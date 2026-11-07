// Streams: logs, stats, engine-wide stats totals and terminals arrive over
// Tauri channels; every start call returns an id to stop it with. Pop-out
// windows show one place.
import { Channel } from "@tauri-apps/api/core";
import { call, toAppError } from "./core";

export interface LogLine {
  /** From stderr. */
  err: boolean;
  /** RFC 3339 from the engine; "" if none. */
  time: string;
  text: string;
}

export type LogMessage = { type: "lines"; lines: LogLine[] } | { type: "end"; error: string | null };

export interface LogQuery {
  follow: boolean;
  /** Last N lines; omit for all. */
  tail?: number;
  /** Unix seconds. */
  since?: number;
  until?: number;
}

export type TermMessage = { type: "output"; data: string } | { type: "exit"; code: number | null; message: string | null };

export interface StatsSample {
  time: string;
  /** 100 = one CPU fully used. */
  cpuPercent: number;
  onlineCpus: number;
  memUsed: number;
  memLimit: number;
  /** Totals since start; turn into rates between samples. */
  netRx: number;
  netTx: number;
  blockRead: number;
  blockWrite: number;
  pids: number;
}

/** One container's latest figures in the totals; rates are bytes per second. */
export interface ContainerFigures {
  id: string;
  name: string;
  cpuPercent: number;
  memUsed: number;
  memLimit: number;
  netRxRate: number;
  netTxRate: number;
  blockReadRate: number;
  blockWriteRate: number;
}

/** Engine-wide totals, sent every 2 s while the dashboard overview is open. */
export interface TotalsSnapshot {
  /** Sum over containers; 100 = one CPU. */
  cpuPercent: number;
  /** CPUs the engine has (the most any container reports). */
  onlineCpus: number;
  memUsed: number;
  /** The largest container limit: the engine's memory when none are limited. */
  memLimit: number;
  netRxRate: number;
  netTxRate: number;
  blockReadRate: number;
  blockWriteRate: number;
  /** Containers counted. */
  counted: number;
  /** Running containers left out by the cap (100). */
  skipped: number;
  /** Highest CPU first. */
  containers: ContainerFigures[];
}

/** The stream ends (`end`) when the engine goes away; start it again on reconnect. */
export type TotalsMessage = ({ type: "totals" } & TotalsSnapshot) | { type: "end"; error: string | null };

/** A channel, or an AppError when there's no Tauri runtime (plain browser). */
function channel<T>(onMessage: (m: T) => void): Channel<T> {
  try {
    const c = new Channel<T>();
    c.onmessage = onMessage;
    return c;
  } catch (e) {
    throw toAppError(e);
  }
}

export const streamsApi = {
  logs: async (id: string, query: LogQuery, onMessage: (m: LogMessage) => void) =>
    call<number>("stream_logs", { id, query, onMessage: channel(onMessage) }),
  stop: (stream: number) => call<void>("stop_stream", { stream }),
  /** Writes the range to `path`; resolves with the number of lines. */
  exportLogs: (id: string, query: LogQuery, timestamps: boolean, path: string) =>
    call<number>("export_logs", { id, query, timestamps, path }),

  terminalOpen: async (id: string, cols: number, rows: number, onMessage: (m: TermMessage) => void) =>
    call<number>("terminal_open", { id, cols, rows, onMessage: channel(onMessage) }),
  terminalInput: (session: number, data: string) => call<void>("terminal_input", { session, data }),
  terminalResize: (session: number, cols: number, rows: number) => call<void>("terminal_resize", { session, cols, rows }),
  terminalClose: (session: number) => call<void>("terminal_close", { session }),

  stats: async (id: string, onSample: (s: StatsSample) => void) => call<number>("stream_stats", { id, onMessage: channel(onSample) }),
  /** Engine-wide totals: one stats stream per running container, summed in Rust. */
  statsTotals: async (onMessage: (m: TotalsMessage) => void) => call<number>("stream_stats_totals", { onMessage: channel(onMessage) }),

  openPopout: (address: string, title: string) => call<void>("open_popout", { address, title }),
};
