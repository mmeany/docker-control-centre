// The Docker engine: info, containers, and the change feed.
import { Channel } from "@tauri-apps/api/core";
import { call, toAppError } from "./core";

export interface EngineInfo {
  /** Daemon host name. */
  name: string;
  endpoint: string;
  serverVersion: string;
  operatingSystem: string;
  containers: number;
  running: number;
  images: number;
}

export type ContainerState = "created" | "running" | "paused" | "restarting" | "exited" | "removing" | "dead" | "";

export interface ContainerItem {
  id: string;
  name: string;
  image: string;
  state: ContainerState;
  /** "Up 3 hours", "Exited (0) 2 days ago". */
  status: string;
  /** ISO 8601 UTC. */
  created: string;
  ports: string[];
  project: string | null;
  service: string | null;
  workingDir: string | null;
}

export type EngineResource = "container" | "image" | "volume" | "network";

export type EngineMessage =
  | { type: "connected" }
  | { type: "disconnected"; message: string }
  | { type: "changed"; resource: EngineResource; action: string; id: string };

export const engineApi = {
  info: () => call<EngineInfo>("engine_info"),
  listContainers: () => call<ContainerItem[]>("list_containers"),
  /** Starts the change feed (replacing any earlier one). Async so that a
   *  missing Tauri runtime (plain browser) rejects instead of throwing. */
  watch: async (onMessage: (m: EngineMessage) => void) => {
    let channel: Channel<EngineMessage>;
    try {
      channel = new Channel<EngineMessage>();
    } catch (e) {
      throw toAppError(e);
    }
    channel.onmessage = onMessage;
    return call<void>("watch_engine", { onMessage: channel });
  },
};
