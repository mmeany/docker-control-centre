// Streams: logs, stats and terminals arrive over Tauri channels; every start
// call returns an id to stop it with. Pop-out windows show one place.
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

  openPopout: (address: string, title: string) => call<void>("open_popout", { address, title }),
};
