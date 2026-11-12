// Compose: run verbs (in WSL or on the host), pinned files, dropped files, WSL distros.
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
  /** As chosen (Windows paths), in -f order. */
  files: string[];
}

/** One file offered when compose files or a folder are dropped. */
export interface DropCandidate {
  path: string;
  /** base: compose's default file; override: layered on it; variant: anything else. */
  role: "base" | "override" | "variant";
  ticked: boolean;
}

/** One folder's worth of a drop. */
export interface DropGroup {
  dir: string;
  candidates: DropCandidate[];
  /** Why nothing from here can run. */
  error: string | null;
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
  /** Pins one project's files (in -f order); compose must read them. */
  pin: (files: string[]) => call<Pinned[]>("compose_pin", { files }),
  /** The project name compose gives these files, checking they read. */
  projectName: (files: string[]) => call<string>("compose_project_name", { files }),
  /** Dropped files and folders as projects to confirm (nothing runs). */
  dropCandidates: (paths: string[]) => call<DropGroup[]>("compose_drop_candidates", { paths }),
  unpin: (name: string) => call<Pinned[]>("compose_unpin", { name }),
  saveText: (path: string, text: string) => call<void>("save_text_file", { path, text }),
};
