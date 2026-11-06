import type { ReactNode } from "react";
import type { ConfirmButton } from "../components/ConfirmDialog";
import type { MenuItem } from "../components/ContextMenu";
import type { ViewMode } from "../components/FileList";
import type { EngineState } from "../state/engine";
import type { Place } from "./places";

/** What the app shell provides to every section. */
export interface Shell {
  place: Place;
  navigate: (p: Place) => void;
  /** Opens a place in a new tab (and switches to it). */
  openInNewTab: (p: Place) => void;
  /** Connection, engine info and change counters. */
  engine: EngineState;
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
}
