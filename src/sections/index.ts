// The section registry: everything the app can show, in tree / Home order.
// Add a section: write sections/<id>/use<Id>Section.tsx (a hook returning
// SectionUi) and add an entry here. The shell calls every section's hook on
// each render, in this order, so the list must not change at runtime.
import type { ReactNode } from "react";
import { createElement } from "react";
import { ContainerIcon } from "../components/Icons";
import type { SectionUi, Shell } from "../shell/shell";
import { containersCrumbs, containersParent, isContainersPath, useContainersSection } from "./containers/useContainersSection";

export interface SectionDef {
  id: string;
  name: string;
  description: string;
  icon: ReactNode;
  /** Path the section opens at. */
  root: string;
  /** Address-bar segments below the section name. */
  crumbs?: (path: string) => { label: string; path: string }[];
  /** Path one level up; null / undefined = the section root. */
  parent?: (path: string) => string | null;
  /** Copyable form of a path (defaults to "/<id>/<path>"). */
  uri?: (path: string) => string;
  /** Whether a typed address (below the section) is a path here; default: any. */
  isPath?: (path: string) => boolean;
  /** Controller hook. */
  use: (shell: Shell) => SectionUi;
}

export const SECTIONS: SectionDef[] = [
  {
    id: "containers",
    name: "Containers",
    description: "Compose projects and containers: open one for its logs, terminal, stats and files",
    icon: createElement(ContainerIcon),
    root: "",
    crumbs: containersCrumbs,
    parent: containersParent,
    isPath: isContainersPath,
    use: useContainersSection,
  },
];
