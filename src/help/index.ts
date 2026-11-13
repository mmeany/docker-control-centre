// In-app help: a short Markdown topic per view and larger dialog, written for
// someone looking at it (the README is the overview for the repository).
// Topic ids are checked by the compiler, so nothing can point at a missing
// topic. List levels look different in the two layouts, so they have a topic
// per layout; detail views and dialogs share one.
import { parseContainers } from "../sections/containers/paths";
import type { Layout } from "../shell/layout";
import type { Place } from "../shell/places";
import { composeTopics } from "./topics/compose";
import { containersTopics } from "./topics/containers";
import { generalTopics } from "./topics/general";
import { resourcesTopics } from "./topics/resources";

export interface HelpTopicText {
  title: string;
  /** Markdown (the subset components/Markdown.tsx renders). */
  body: string;
}

export const HELP_TOPICS = {
  ...generalTopics,
  ...containersTopics,
  ...composeTopics,
  ...resourcesTopics,
} satisfies Record<string, HelpTopicText>;

export type HelpTopicId = keyof typeof HELP_TOPICS;

/** Places that look different in the two layouts: each has `<level>.<layout>`. */
export type ListLevel = "home" | "containers.list" | "containers.project" | "compose.list" | "images.list" | "volumes.list" | "networks.list";

/** The topic for a list level in a layout (the compiler checks both exist). */
export function listTopic(level: ListLevel, layout: Layout): HelpTopicId {
  return `${level}.${layout}` as const;
}

/** The general topic for a layout. */
export const generalTopic = (layout: Layout): HelpTopicId => (layout === "explorer" ? "general.explorer" : "general.dashboard");

/** The topic for a place, before any dialog or view has a say. */
export function placeTopic(p: Place, layout: Layout): HelpTopicId {
  switch (p.section) {
    case null:
      return listTopic("home", layout);
    case "containers": {
      const loc = parseContainers(p.path);
      if (!loc || loc.kind === "root") return listTopic("containers.list", layout);
      if (loc.kind === "project") return listTopic("containers.project", layout);
      if (loc.kind === "container") return "containers.container";
      switch (loc.child) {
        case "logs":
          return "containers.logs";
        case "terminal":
          return "containers.terminal";
        case "stats":
          return "containers.stats";
        case "files":
          return "containers.files";
        default:
          return "containers.details";
      }
    }
    case "compose": {
      const [name, child] = p.path.split("/");
      if (!name) return listTopic("compose.list", layout);
      if (child === "logs") return "compose.logs";
      if (child === "file") return "compose.file";
      return "compose.project";
    }
    case "images":
      return p.path ? "images.image" : listTopic("images.list", layout);
    case "volumes":
      return p.path ? "volumes.volume" : listTopic("volumes.list", layout);
    case "networks":
      return p.path ? "networks.network" : listTopic("networks.list", layout);
    default:
      return generalTopic(layout);
  }
}
