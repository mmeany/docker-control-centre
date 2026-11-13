// A container's ports as the lists and details pane show them: what's
// published now, or, when it isn't running, what it publishes when it starts
// (the engine's list only has ports for running containers).
import type { ContainerItem } from "../../api/engine";
import type { Cell } from "../../components/FileList";

export const CONFIGURED_PORTS_TIP = "Not running: published when it starts.";

/** Live ports, else the configured ones, faded with a tooltip saying why. */
export function portsCell(c: ContainerItem): Cell {
  if (c.ports.length || !c.configuredPorts.length) return { text: c.ports.join(", "), sort: c.ports.join(",") };
  return { text: c.configuredPorts.join(", "), sort: c.configuredPorts.join(","), muted: true, title: CONFIGURED_PORTS_TIP };
}

/** For the details pane: configured ports say they apply when it starts. */
export function portsText(c: ContainerItem): string {
  if (c.ports.length || !c.configuredPorts.length) return c.ports.join(", ");
  return `${c.configuredPorts.join(", ")} (when it starts)`;
}
