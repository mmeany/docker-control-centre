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
  /** "sha256:…". */
  imageId: string;
  state: ContainerState;
  /** "Up 3 hours", "Exited (0) 2 days ago". */
  status: string;
  /** From "Exited (137) …"; null while running or never run. */
  exitCode: number | null;
  /** "starting", "healthy", "unhealthy", or "" without a health check. */
  health: "" | "starting" | "healthy" | "unhealthy";
  /** ISO 8601 UTC. */
  created: string;
  /** What's published now ("8080→80/tcp"); empty unless running. */
  ports: string[];
  /** Not running: what it publishes when it starts (from its configuration). */
  configuredPorts: string[];
  project: string | null;
  service: string | null;
  workingDir: string | null;
  /** Compose files it was started from (engine-side paths). */
  configFiles: string[];
  /** Volumes it mounts, by name. */
  volumes: string[];
  /** The same volumes with where each is mounted, in the same order. */
  volumeMounts: VolumeMount[];
  /** Networks it's on, by name. */
  networks: string[];
}

export interface VolumeMount {
  name: string;
  destination: string;
}

/** Why Docker made an anonymous volume: an image VOLUME nothing mounts over, a mount given no source, or can't tell. */
export type AnonymousCause = "image" | "noSource" | "unknown";

export type ContainerAction =
  | { type: "start" | "stop" | "restart" | "pause" | "unpause" | "kill" }
  | { type: "remove"; force: boolean; volumes: boolean };

/** One container's outcome; error is null when it worked. */
export interface ActionResult {
  id: string;
  error: string | null;
}

export interface KeyValue {
  key: string;
  value: string;
}

export interface MountInfo {
  kind: string;
  name: string;
  source: string;
  destination: string;
  mode: string;
  readWrite: boolean;
  /** Set for an anonymous volume: why Docker made it. */
  anonymous: AnonymousCause | null;
}

export interface PortInfo {
  /** "80/tcp". */
  containerPort: string;
  /** "0.0.0.0:8080"; empty when only exposed. */
  host: string[];
}

export interface NetworkInfo {
  name: string;
  ipAddress: string;
  gateway: string;
  macAddress: string;
  aliases: string[];
}

export interface ContainerDetails {
  id: string;
  name: string;
  image: string;
  imageId: string;
  command: string;
  created: string;
  state: ContainerState;
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  error: string;
  health: string;
  restartPolicy: string;
  restartCount: number;
  platform: string;
  workingDir: string;
  user: string;
  hostname: string;
  project: string | null;
  service: string | null;
  projectDir: string | null;
  env: KeyValue[];
  labels: KeyValue[];
  mounts: MountInfo[];
  ports: PortInfo[];
  /** Not running: `ports` hosts are what it publishes when it starts. */
  portsConfigured: boolean;
  networks: NetworkInfo[];
}

export type EngineResource = "container" | "image" | "volume" | "network";

export type EngineMessage =
  | { type: "connected" }
  | { type: "disconnected"; message: string }
  | { type: "changed"; resource: EngineResource; action: string; id: string };

export const engineApi = {
  info: () => call<EngineInfo>("engine_info"),
  listContainers: () => call<ContainerItem[]>("list_containers"),
  inspectContainer: (id: string) => call<ContainerDetails>("inspect_container", { id }),
  containerAction: (ids: string[], action: ContainerAction) => call<ActionResult[]>("container_action", { ids, action }),
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
