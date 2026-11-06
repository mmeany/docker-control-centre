// The section registry: everything the app can show, in tree / Home order.
// Add a section: write sections/<id>/use<Id>Section.tsx (a hook returning
// SectionUi) and add an entry here. The shell calls every section's hook on
// each render, in this order, so the list must not change at runtime.
import type { ReactNode } from "react";
import { createElement } from "react"; // sample
import { DriveIcon } from "../components/Icons"; // sample
import type { SectionUi, Shell } from "../shell/shell";
import { filesCrumbs, filesParent, useFilesSection } from "./files/useFilesSection"; // sample

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
  /** Copyable form of a path (defaults to the path). */
  uri?: (path: string) => string;
  /** Controller hook. */
  use: (shell: Shell) => SectionUi;
}

export const SECTIONS: SectionDef[] = [
  // sample:start
  {
    id: "files",
    name: "Local files",
    description: "Sample section: browse a folder on this computer and preview text files",
    icon: createElement(DriveIcon),
    root: "",
    crumbs: filesCrumbs,
    parent: filesParent,
    use: useFilesSection,
  },
  // sample:end
];
