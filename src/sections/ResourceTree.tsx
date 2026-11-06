// The tree branch shared by Images, Volumes and Networks: the items with
// their status marks, filtered by the Show level (the open item always
// shows), a "+ n more" row that reveals the rest, orphans grouped in an
// "Orphaned (n)" folder, and a badge on the section node (which counts
// everything, hidden or not).
import { useEffect, useState, type ReactNode } from "react";
import { SectionBadge } from "../components/SectionBadge";
import { TreeMore, TreeNote, TreeRow } from "../components/TreeRow";
import { partition, type TreeLevel } from "../status/filter";
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
  level: TreeLevel;
  rootSelected: boolean;
  onRoot: () => void;
  onOpen: (key: string) => void;
  onMenu: (key: string, x: number, y: number) => void;
}

export function ResourceTree({ label, icon, items, note, emptyText, selected, level, rootSelected, onRoot, onOpen, onMenu }: Props) {
  const [open, setOpen] = useState(false);
  const [orphansOpen, setOrphansOpen] = useState(true);
  const [revealed, setRevealed] = useState(false);
  // A new Show level starts afresh.
  useEffect(() => setRevealed(false), [level]);
  // Opening the open item's section shows it in the tree.
  useEffect(() => {
    if (selected && (items ?? []).some((i) => i.key === selected)) setOpen(true);
  }, [selected, items]);
  const all = items ?? [];
  const { shown, summary } = partition(all, (i) => i.status, revealed ? "all" : level, (i) => i.key === selected);
  const orphanCount = all.filter((i) => i.status.state === "orphaned").length;
  const orphans = shown.filter((i) => i.status.state === "orphaned");
  const rest = shown.filter((i) => i.status.state !== "orphaned");
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
      badge={<SectionBadge errors={0} orphans={orphanCount} />}
      selected={rootSelected}
      expanded={open}
      onClick={onRoot}
      onToggle={() => {
        // Collapsing drops a reveal back to the Show level.
        if (open) setRevealed(false);
        setOpen((v) => !v);
      }}
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
          {summary && (
            <TreeMore depth={2} onClick={() => setRevealed(true)}>
              {summary}
            </TreeMore>
          )}
        </>
      )}
    </TreeRow>
  );
}
