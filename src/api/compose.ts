// Compose: run verbs (in WSL or on the host), pinned files, WSL distros.
import { Channel } from "@tauri-apps/api/core";
import { call, toAppError } from "./core";

/** A project to run compose against: its folder and files (Windows or Linux paths). */
export interface ComposeTarget {
  name: string | null;
  dir: string;
  files: string[];
}

export type ComposeVerb = "up" | "down" | "down-volumes" | "restart" | "stop" | "start" | "pull";

export type ComposeMessage = { type: "line"; text: string; err: boolean } | { type: "exit"; code: number | null; error: string | null };

export interface ComposeOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface Pinned {
  name: string;
  /** As chosen (a Windows path). */
  file: string;
}

export interface Distro {
  name: string;
  default: boolean;
  running: boolean;
  version: number;
}

export interface ComposeFile {
  /** Where it was read from (a Windows path on Windows). */
  path: string;
  text: string;
  size: number;
}

/** Settings keys (values). */
export const COMPOSE_MODE_KEY = "compose.mode";
export const COMPOSE_DISTRO_KEY = "compose.distro";

export const composeApi = {
  run: async (target: ComposeTarget, verb: ComposeVerb, onMessage: (m: ComposeMessage) => void) => {
    let channel: Channel<ComposeMessage>;
    try {
      channel = new Channel<ComposeMessage>();
    } catch (e) {
      throw toAppError(e);
    }
    channel.onmessage = onMessage;
    return call<number>("compose_run", { target, verb, onMessage: channel });
  },
  /** `docker compose version` with the current settings. */
  version: () => call<ComposeOutput>("compose_check", { target: null, verb: "version" }),
  /** `docker compose config` as YAML: the merged file with variables filled in (may hold secrets). */
  resolved: (target: ComposeTarget) => call<ComposeOutput>("compose_check", { target, verb: "config-yaml" }),
  /** A project's compose file (an engine-side or Windows path), up to 1 MB. */
  readFile: (path: string) => call<ComposeFile>("compose_read_file", { path }),
  /** Shows the file in Explorer ("folder") or opens it in its default app ("open"). */
  showFile: (path: string, how: "folder" | "open") => call<void>("compose_show_file", { path, how }),
  distros: () => call<Distro[]>("wsl_distros"),
  pinned: () => call<Pinned[]>("compose_pinned"),
  pin: (file: string) => call<Pinned[]>("compose_pin", { file }),
  unpin: (name: string) => call<Pinned[]>("compose_unpin", { name }),
  saveText: (path: string, text: string) => call<void>("save_text_file", { path, text }),
};
