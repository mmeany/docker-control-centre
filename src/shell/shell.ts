import type { ReactNode } from "react";
import type { ConfirmButton } from "../components/ConfirmDialog";
import type { MenuItem } from "../components/ContextMenu";
import type { ViewMode } from "../components/FileList";
import type { Pinned } from "../api/compose";
import type { ContainerItem } from "../api/engine";
import type { TreeLevel } from "../status/filter";
import type { Status } from "../status/status";
import type { EngineState } from "../state/engine";
import type { EngineList } from "../state/engineList";
import type { Place } from "./places";

/** What the app shell provides to every section. */
export interface Shell {
  place: Place;
  navigate: (p: Place) => void;
  /** Opens a place in a new tab (and switches to it). */
  openInNewTab: (p: Place) => void;
  /** Opens a place in its own window; absent inside a pop-out window. */
  popOut?: (p: Place) => void;
  /** Connection, engine info and change counters. */
  engine: EngineState;
  /** Every container (shared: sections show what uses what). */
  containers: EngineList<ContainerItem>;
  /** Pinned compose files (settings), and replacing them after pin / unpin. */
  composePinned: Pinned[];
  setComposePinned: (list: Pinned[]) => void;
  /** Compose projects that exist: with containers, or pinned. */
  liveProjects: Set<string>;
  /** How much the tree shows (Show control); lists aren't filtered. */
  treeLevel: TreeLevel;
  /** View chosen for this place (pass to FileList). */
  view: ViewMode;
  /** Modal question; resolves with the chosen button's value. */
  ask: (title: string, body: ReactNode, buttons: ConfirmButton<string>[], cancelValue: string) => Promise<string>;
  /** Single-line text prompt; resolves with the value or null if cancelled. */
  askName: (
    title: string,
    label: string,
    initial: string,
    okLabel: string,
    validate: (v: string) => string | null,
  ) => Promise<string | null>;
  /** Irreversible action: resolves true only if the user types `confirmText`. */
  confirmTyped: (title: string, body: ReactNode, confirmText: string, actionLabel: string) => Promise<boolean>;
  showError: (e: unknown) => void;
  /** Brief status-bar message. */
  showFlash: (msg: string) => void;
  /** Long-running status ("Deleting…"); null clears. */
  setWorking: (msg: string | null) => void;
  openMenu: (x: number, y: number, items: MenuItem[]) => void;
  copyText: (text: string) => Promise<void>;
}

/** What each section gives back to the shell to place on screen. */
export interface SectionUi {
  /** The section's node (and children) for the tree. */
  tree: ReactNode;
  /** Main-panel content when the section is active. */
  content: ReactNode;
  /** Dashboard layout: cards or a roomy table in place of `content` (optional). */
  board?: ReactNode;
  /** Command-bar buttons when active. */
  commands: ReactNode;
  /** Status-bar text when active. */
  status: string;
  busy: boolean;
  refresh: () => void;
  /** Dialogs the section has open. */
  dialogs: ReactNode;
  /** Details pane content for the selection (or the open item). */
  details?: ReactNode;
  /** Del key. */
  onDelete?: () => void;
  /**
   * Runs one of the section's verbs on one item from outside the section
   * (dashboard overview, boards), with the section's own confirmations and
   * dialogs. Containers: a container id and a container verb ("restart").
   * Compose: a project name and a compose verb ("up", "stop").
   */
  act?: (key: string, verb: string) => void;
  /** The state of what a path in this section shows (tab marks). */
  placeStatus?: (path: string) => Status | undefined;
  /** Counts for the section badges (Home). */
  attention?: { errors: number; orphans: number };
}
