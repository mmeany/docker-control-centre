// Shared IPC layer. src/api/ is the only place that calls invoke(), so the
// rest of the UI also runs in a plain browser (see tools/ui-check). Each
// section has its own file (files.ts, …) built on `call`.
import { invoke } from "@tauri-apps/api/core";

export type ThemePref = "system" | "light" | "dark";

export interface Settings {
  theme: ThemePref;
  /** Remembered filters, newest first, keyed e.g. "<section>|<scope>". */
  filterHistory: Record<string, string[]>;
  /** Small values sections keep between runs (recent folders, options, …). */
  values: Record<string, unknown>;
}

export type ErrorKind = "notFound" | "accessDenied" | "invalid" | "other";

export interface AppError {
  kind: ErrorKind;
  message: string;
  detail: string;
}

/** Normalises anything thrown by invoke() into an AppError. */
export function toAppError(e: unknown): AppError {
  if (e && typeof e === "object" && "kind" in e && "message" in e) {
    return e as AppError;
  }
  const message = e instanceof Error ? e.message : String(e);
  return { kind: "other", message, detail: message };
}

/** Invokes a Rust command, normalising errors to AppError. */
export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toAppError(e);
  }
}
