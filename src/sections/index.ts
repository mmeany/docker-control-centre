// The section registry: everything the app can show, in tree / Home order.
// Add a section: write sections/<id>/use<Id>Section.tsx (a hook returning
// SectionUi) and add an entry here. The shell calls every section's hook on
// each render, in this order, so the list must not change at runtime.
import type { ReactNode } from "react";
import { createElement } from "react";
import { ContainerIcon, ImageIcon, NetworkIcon, ProjectIcon, VolumeIcon } from "../components/Icons";
import type { SectionUi, Shell } from "../shell/shell";
import { composePaths, useComposeSection } from "./compose/useComposeSection";
import { containersCrumbs, containersParent, isContainersPath, useContainersSection } from "./containers/useContainersSection";
import { imagesPaths, useImagesSection } from "./images/useImagesSection";
import { networksPaths, useNetworksSection } from "./networks/useNetworksSection";
import { useVolumesSection, volumesPaths } from "./volumes/useVolumesSection";

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
  {
    id: "compose",
    name: "Compose",
    description: "Compose projects, running or pinned: up, stop, restart, pull, down, and every service's logs merged",
    icon: createElement(ProjectIcon),
    root: "",
    ...composePaths,
    use: useComposeSection,
  },
  {
    id: "images",
    name: "Images",
    description: "Images on the engine: pull, inspect, see what uses them, delete and prune",
    icon: createElement(ImageIcon),
    root: "",
    ...imagesPaths,
    use: useImagesSection,
  },
  {
    id: "volumes",
    name: "Volumes",
    description: "Named and anonymous volumes, and the containers using them",
    icon: createElement(VolumeIcon),
    root: "",
    ...volumesPaths,
    use: useVolumesSection,
  },
  {
    id: "networks",
    name: "Networks",
    description: "Networks, their subnets and the containers attached",
    icon: createElement(NetworkIcon),
    root: "",
    ...networksPaths,
    use: useNetworksSection,
  },
];
