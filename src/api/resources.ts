// Images, volumes and networks.
import { Channel } from "@tauri-apps/api/core";
import { call, toAppError } from "./core";
import type { ActionResult, KeyValue } from "./engine";

export interface ImageItem {
  /** "sha256:…". */
  id: string;
  /** Empty for a dangling image. */
  tags: string[];
  digests: string[];
  created: string;
  size: number;
}

export interface HistoryItem {
  id: string;
  created: string;
  createdBy: string;
  size: number;
  comment: string;
}

export interface ImageDetails {
  id: string;
  tags: string[];
  digests: string[];
  created: string;
  size: number;
  platform: string;
  author: string;
  entrypoint: string;
  command: string;
  workingDir: string;
  user: string;
  exposedPorts: string[];
  env: KeyValue[];
  labels: KeyValue[];
  layers: number;
  history: HistoryItem[];
}

export interface LayerProgress {
  id: string;
  status: string;
  current: number;
  total: number;
}

export type PullMessage = { type: "progress"; layers: LayerProgress[]; status: string } | { type: "done"; error: string | null; status: string };

export interface VolumeItem {
  name: string;
  driver: string;
  mountpoint: string;
  created: string;
  scope: string;
  anonymous: boolean;
  project: string | null;
  labels: KeyValue[];
  options: KeyValue[];
}

export interface NetworkItem {
  id: string;
  name: string;
  driver: string;
  scope: string;
  created: string;
  internal: boolean;
  attachable: boolean;
  ipv6: boolean;
  subnets: string[];
  gateways: string[];
  /** bridge, host, none: can't be removed. */
  builtin: boolean;
  project: string | null;
  labels: KeyValue[];
  options: KeyValue[];
}

export const resourcesApi = {
  listImages: () => call<ImageItem[]>("list_images"),
  inspectImage: (id: string) => call<ImageDetails>("inspect_image", { id }),
  /** By tag (removes that tag) or id. */
  removeImages: (refs: string[], force: boolean) => call<ActionResult[]>("remove_images", { refs, force }),
  pullImage: async (reference: string, onMessage: (m: PullMessage) => void) => {
    let channel: Channel<PullMessage>;
    try {
      channel = new Channel<PullMessage>();
    } catch (e) {
      throw toAppError(e);
    }
    channel.onmessage = onMessage;
    return call<number>("pull_image", { reference, onMessage: channel });
  },
  listVolumes: () => call<VolumeItem[]>("list_volumes"),
  removeVolumes: (names: string[]) => call<ActionResult[]>("remove_volumes", { names }),
  listNetworks: () => call<NetworkItem[]>("list_networks"),
  removeNetworks: (ids: string[]) => call<ActionResult[]>("remove_networks", { ids }),
};
