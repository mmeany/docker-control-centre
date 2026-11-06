// Containers: compose projects and standalone containers as folders. Opening
// a container shows its children (logs, terminal, …). The list reloads when
// the engine reports container changes.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppError } from "../../api/core";
import { engineApi, type ContainerItem } from "../../api/engine";
import { CommandButton, CommandSeparator } from "../../components/CommandButton";
import type { MenuItem } from "../../components/ContextMenu";
import { ErrorPanel } from "../../components/ErrorPanel";
import { FileList, type Column, type Row } from "../../components/FileList";
import {
  ContainerIcon,
  CopyIcon,
  FolderIcon,
  LogsIcon,
  NewItemIcon,
  ProjectIcon,
  PropertiesIcon,
  RefreshIcon,
  StatsIcon,
  TerminalIcon,
} from "../../components/Icons";
import { TreeNote, TreeRow } from "../../components/TreeRow";
import { formatDate } from "../../format";
import type { Place } from "../../shell/places";
import type { SectionUi, Shell } from "../../shell/shell";
import { CHILDREN, containerPath, formatContainers, parseContainers, projectPath, type ChildId } from "./paths";

export { containersCrumbs, containersParent, isContainersPath } from "./paths";

const SECTION = "containers";

const COLUMNS: Column[] = [
  { id: "name", label: "Name", width: 240 },
  { id: "state", label: "State", width: 110 },
  { id: "image", label: "Image", width: 200 },
  { id: "status", label: "Status", width: 170 },
  { id: "ports", label: "Ports", width: 170 },
  { id: "created", label: "Created", width: 150 },
];

const CHILD_COLUMNS: Column[] = [
  { id: "name", label: "Name", width: 180 },
  { id: "desc", label: "Description", width: 420 },
];

const CHILD_ICONS: Record<ChildId, ReactNode> = {
  logs: <LogsIcon />,
  terminal: <TerminalIcon />,
  stats: <StatsIcon />,
  files: <FolderIcon />,
  env: <PropertiesIcon />,
  mounts: <PropertiesIcon />,
  ports: <PropertiesIcon />,
  networks: <PropertiesIcon />,
  labels: <PropertiesIcon />,
};

/** Sort order for the State column: running first. */
const STATE_ORDER: Record<string, number> = { running: 0, restarting: 1, paused: 2, created: 3, removing: 4, exited: 5, dead: 6 };

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

interface Project {
  name: string;
  containers: ContainerItem[];
  running: number;
}

function summarise(list: ContainerItem[]): string {
  const running = list.filter((c) => c.state === "running").length;
  return running === list.length ? `${running} running` : `${running} of ${list.length} running`;
}

export function useContainersSection(shell: Shell): SectionUi {
  const { place, engine, copyText } = shell;
  const active = place.section === SECTION;
  const path = active ? place.path : "";
  const loc = active ? parseContainers(path) : null;
  const go = useCallback((p: string) => shell.navigate({ section: SECTION, path: p } satisfies Place), [shell]);
  const placeOf = (p: string): Place => ({ section: SECTION, path: p });

  const [open, setOpen] = useState(true);
  const [items, setItems] = useState<ContainerItem[] | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Selection belongs to the path it was made in. */
  const [selection, setSelection] = useState({ path: "", keys: new Set<string>() });
  const selected = selection.path === path ? selection.keys : new Set<string>();
  const setSelected = (keys: Set<string>) => setSelection({ path, keys });

  const connected = engine.status === "connected";

  // Load (and reload on container events, reconnects and Refresh).
  useEffect(() => {
    if (!connected) return;
    let stale = false;
    setLoading(true);
    engineApi
      .listContainers()
      .then((list) => {
        if (stale) return;
        setItems(list);
        setError(null);
      })
      .catch((e) => !stale && setError(e as AppError))
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
  }, [connected, engine.changes.container, reloadToken]);

  const refresh = useCallback(() => setReloadToken((t) => t + 1), []);

  const { projects, standalone } = useMemo(() => {
    const byProject = new Map<string, ContainerItem[]>();
    const standalone: ContainerItem[] = [];
    for (const c of items ?? []) {
      if (c.project) byProject.set(c.project, [...(byProject.get(c.project) ?? []), c]);
      else standalone.push(c);
    }
    const projects: Project[] = [...byProject.entries()]
      .map(([name, containers]) => ({ name, containers, running: containers.filter((c) => c.state === "running").length }))
      .sort((a, b) => a.name.localeCompare(b.name));
    standalone.sort((a, b) => a.name.localeCompare(b.name));
    return { projects, standalone };
  }, [items]);

  const byName = useMemo(() => new Map((items ?? []).map((c) => [c.name, c])), [items]);

  // Opening something inside a project expands it in the tree.
  useEffect(() => {
    if (loc && loc.kind !== "root" && loc.project) {
      const p = loc.project;
      setExpanded((s) => (s.has(p) ? s : new Set([...s, p])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // ---------------------------------------------------------------------------
  // Rows

  function containerRow(c: ContainerItem): Row {
    return {
      key: containerPath(c.project, c.name),
      icon: <ContainerIcon state={c.state} />,
      isContainer: false,
      cells: {
        name: { text: c.name, sort: c.name.toLowerCase() },
        state: { text: c.state || "unknown", sort: STATE_ORDER[c.state] ?? 9 },
        image: { text: c.image, sort: c.image },
        status: { text: c.status, sort: c.status },
        ports: { text: c.ports.join(", "), sort: c.ports.join(",") },
        created: { text: formatDate(c.created), sort: c.created },
      },
    };
  }

  function projectRow(p: Project): Row {
    return {
      key: projectPath(p.name),
      icon: <ProjectIcon />,
      isContainer: true,
      cells: {
        name: { text: p.name, sort: p.name },
        state: { text: summarise(p.containers), sort: p.running === p.containers.length ? 0 : 5 },
        image: { text: "Compose project", sort: "" },
        status: { text: plural(p.containers.length, "container"), sort: p.containers.length },
        ports: { text: "", sort: "" },
        created: { text: "", sort: "" },
      },
    };
  }

  const project = loc && loc.kind === "project" ? projects.find((p) => p.name === loc.project) : undefined;
  const container = loc && (loc.kind === "container" || loc.kind === "child") ? byName.get(loc.name) : undefined;

  const rows: Row[] = useMemo(() => {
    if (!loc) return [];
    if (loc.kind === "root") return [...projects.map(projectRow), ...standalone.map(containerRow)];
    if (loc.kind === "project") return (project?.containers ?? []).map(containerRow);
    if (loc.kind === "container" && container)
      return CHILDREN.map((ch) => ({
        key: formatContainers({ kind: "child", project: loc.project, name: loc.name, child: ch.id, rest: "" }),
        icon: CHILD_ICONS[ch.id],
        isContainer: true,
        cells: { name: { text: ch.name, sort: CHILDREN.indexOf(ch) }, desc: { text: ch.description, sort: ch.description } },
      }));
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, path, projects, standalone, project, container]);

  // ---------------------------------------------------------------------------
  // Menus and commands

  const itemOf = (key: string) => {
    const l = parseContainers(key);
    return l && l.kind === "container" ? byName.get(l.name) : undefined;
  };

  function openContextMenu(key: string | null, x: number, y: number) {
    const items: MenuItem[] = [];
    if (key) {
      items.push(
        { label: "Open", bold: true, shortcut: "Enter", onClick: () => go(key) },
        { label: "Open in new tab", onClick: () => shell.openInNewTab(placeOf(key)) },
      );
      const c = itemOf(key);
      if (c) items.push("separator", { label: "Copy name", onClick: () => void copyText(c.name) }, { label: "Copy ID", onClick: () => void copyText(c.id) });
    }
    if (items.length) items.push("separator");
    items.push({ label: "Refresh", shortcut: "F5", onClick: refresh });
    shell.openMenu(x, y, items);
  }

  const single = selected.size === 1 ? [...selected][0] : null;
  const singleItem = single ? itemOf(single) : container;
  const commands = active ? (
    <>
      <CommandButton icon={<FolderIcon />} label="Open" title="Open the selected item (Enter)" disabled={!single} onClick={() => single && go(single)} />
      <CommandButton
        icon={<NewItemIcon />}
        label="Open in new tab"
        title="Open the selected item in a new tab"
        disabled={!single}
        onClick={() => single && shell.openInNewTab(placeOf(single))}
      />
      <CommandSeparator />
      <CommandButton icon={<CopyIcon />} label="Copy ID" title="Copy the container's full ID" disabled={!singleItem} onClick={() => singleItem && void copyText(singleItem.id)} />
      <CommandSeparator />
      <CommandButton icon={<RefreshIcon />} label="Refresh" title="Refresh (F5)" onClick={refresh} />
    </>
  ) : null;

  // ---------------------------------------------------------------------------
  // Tree

  const containerNode = (c: ContainerItem, depth: number) => {
    const p = containerPath(c.project, c.name);
    return (
      <TreeRow
        key={p}
        depth={depth}
        label={c.name}
        icon={<ContainerIcon state={c.state} />}
        title={`${c.name}: ${c.status}`}
        selected={active && loc !== null && (loc.kind === "container" || loc.kind === "child") && loc.name === c.name}
        onClick={() => go(p)}
        onContextMenu={(x, y) => openContextMenu(p, x, y)}
      />
    );
  };

  let treeBody: ReactNode;
  if (!connected && items === null) treeBody = <TreeNote depth={2}>{engine.status === "connecting" ? "Connecting…" : "Not connected"}</TreeNote>;
  else if (items === null) treeBody = <TreeNote depth={2}>Loading…</TreeNote>;
  else if (items.length === 0) treeBody = <TreeNote depth={2}>No containers</TreeNote>;
  else
    treeBody = (
      <>
        {projects.map((p) => (
          <TreeRow
            key={p.name}
            depth={2}
            label={p.name}
            icon={<ProjectIcon />}
            title={`${p.name}: ${summarise(p.containers)}`}
            selected={active && loc?.kind === "project" && loc.project === p.name}
            expanded={expanded.has(p.name)}
            onClick={() => go(projectPath(p.name))}
            onToggle={() =>
              setExpanded((s) => {
                const n = new Set(s);
                if (n.has(p.name)) n.delete(p.name);
                else n.add(p.name);
                return n;
              })
            }
            onContextMenu={(x, y) => openContextMenu(projectPath(p.name), x, y)}
          >
            {p.containers.map((c) => containerNode(c, 3))}
          </TreeRow>
        ))}
        {standalone.map((c) => containerNode(c, 2))}
      </>
    );

  const tree = (
    <TreeRow
      depth={1}
      label="Containers"
      icon={<ContainerIcon />}
      selected={active && loc?.kind === "root"}
      expanded={open}
      onClick={() => go("")}
      onToggle={() => setOpen((v) => !v)}
    >
      {treeBody}
    </TreeRow>
  );

  // ---------------------------------------------------------------------------
  // Content and status

  let content: ReactNode = null;
  let status = "";
  if (active) {
    const list = (emptyText: string) => (
      <FileList
        key={path}
        columns={loc?.kind === "container" ? CHILD_COLUMNS : COLUMNS}
        rows={rows}
        selected={selected}
        onSelectionChange={setSelected}
        onOpen={go}
        onContextMenu={openContextMenu}
        emptyText={emptyText}
      />
    );
    const notFound = (message: string): AppError => ({ kind: "notFound", message, detail: "" });

    if (!loc) {
      content = <ErrorPanel error={{ kind: "invalid", message: `${path} isn't a container path.`, detail: "" }} />;
    } else if (error) {
      content = <ErrorPanel error={error} onRetry={refresh} />;
    } else if (items === null) {
      content = <div className="empty-note">{connected || engine.status === "connecting" ? "Loading…" : engine.message || "Not connected to the engine."}</div>;
    } else if (loc.kind === "root") {
      content = list("No containers. Containers you create or start with Compose show up here.");
      const running = items.filter((c) => c.state === "running").length;
      status = `${plural(projects.length, "project")} · ${plural(items.length, "container")} · ${running.toLocaleString()} running`;
    } else if (loc.kind === "project") {
      content = project ? list("This project has no containers.") : <ErrorPanel error={notFound(`There's no compose project called ${loc.project}.`)} />;
      if (project) status = `${plural(project.containers.length, "container")} · ${summarise(project.containers)}`;
    } else if (!container) {
      content = <ErrorPanel error={notFound(`There's no container called ${loc.name}. It may have been removed.`)} />;
    } else if (loc.kind === "container") {
      content = list("");
      status = `${container.name} · ${container.image} · ${container.status}`;
    } else {
      const child = CHILDREN.find((c) => c.id === loc.child)!;
      content = <div className="empty-note center">The {child.name.toLowerCase()} view isn't built yet.</div>;
      status = `${container.name} · ${child.name}`;
    }
    if (selected.size > 1) status += ` · ${selected.size} selected`;
  }

  return { tree, content, commands, status, busy: active && loading, refresh, dialogs: null };
}
