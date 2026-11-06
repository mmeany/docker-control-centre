// The tree branch shared by Images, Volumes and Networks: the items with
// their status marks, orphans grouped in an "Orphaned (n)" folder (shown only
// when there are any), and a badge on the section node.
import { useState, type ReactNode } from "react";
import { SectionBadge } from "../components/SectionBadge";
import { TreeNote, TreeRow } from "../components/TreeRow";
import type { Status } from "../status/status";

export interface TreeItem {
  key: string;
  label: string;
  status: Status;
}

interface Props {
  label: string;
  icon: ReactNode;
  /** null while loading. */
  items: TreeItem[] | null;
  note: string;
  emptyText: string;
  selected: string | null;
  rootSelected: boolean;
  onRoot: () => void;
  onOpen: (key: string) => void;
  onMenu: (key: string, x: number, y: number) => void;
}

export function ResourceTree({ label, icon, items, note, emptyText, selected, rootSelected, onRoot, onOpen, onMenu }: Props) {
  const [open, setOpen] = useState(false);
  const [orphansOpen, setOrphansOpen] = useState(true);
  const orphans = (items ?? []).filter((i) => i.status.state === "orphaned");
  const rest = (items ?? []).filter((i) => i.status.state !== "orphaned");
  const row = (i: TreeItem, depth: number) => (
    <TreeRow
      key={i.key}
      depth={depth}
      label={i.label}
      icon={icon}
      status={i.status}
      selected={selected === i.key}
      onClick={() => onOpen(i.key)}
      onContextMenu={(x, y) => onMenu(i.key, x, y)}
    />
  );
  return (
    <TreeRow
      depth={1}
      label={label}
      icon={icon}
      badge={<SectionBadge errors={0} orphans={orphans.length} />}
      selected={rootSelected}
      expanded={open}
      onClick={onRoot}
      onToggle={() => setOpen((v) => !v)}
    >
      {items === null ? (
        <TreeNote depth={2}>{note}</TreeNote>
      ) : items.length === 0 ? (
        <TreeNote depth={2}>{emptyText}</TreeNote>
      ) : (
        <>
          {rest.map((i) => row(i, 2))}
          {orphans.length > 0 && (
            <TreeRow
              depth={2}
              label={`Orphaned (${orphans.length})`}
              icon={icon}
              status={{ state: "orphaned", label: "Orphaned", reason: "Nothing uses these and nothing will: Prune → Orphaned only removes them." }}
              expanded={orphansOpen}
              onClick={() => setOrphansOpen((v) => !v)}
              onToggle={() => setOrphansOpen((v) => !v)}
            >
              {orphans.map((i) => row(i, 3))}
            </TreeRow>
          )}
        </>
      )}
    </TreeRow>
  );
}
