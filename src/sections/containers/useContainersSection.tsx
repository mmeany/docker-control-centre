// Containers: compose projects and standalone containers as folders. Opening
// a container shows its children (logs, terminal, environment, …). Lists
// reload when the engine reports container changes; actions run on the
// selection (a project stands for its containers) or on the open container.
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppError } from "../../api/core";
import { engineApi, type ContainerDetails, type ContainerItem } from "../../api/engine";
import { CommandButton, CommandSeparator } from "../../components/CommandButton";
import type { MenuItem } from "../../components/ContextMenu";
import { ErrorPanel } from "../../components/ErrorPanel";
import { FileList, type Column, type Row } from "../../components/FileList";
import {
  ContainerIcon,
  CopyIcon,
  DeleteIcon,
  FolderIcon,
  LogsIcon,
  PauseIcon,
  PlayIcon,
  ProjectIcon,
  PropertiesIcon,
  RefreshIcon,
  RestartIcon,
  StatsIcon,
  StopIcon,
  TerminalIcon,
} from "../../components/Icons";
import { TreeNote, TreeRow } from "../../components/TreeRow";
import { formatDate } from "../../format";
import type { Place } from "../../shell/places";
import type { SectionUi, Shell } from "../../shell/shell";
import { applicable, summary, VERBS, working, type Verb } from "./actions";
import { CHILDREN, containerPath, formatContainers, parseContainers, projectPath, type ChildId, type ContainersLoc } from "./paths";
import { FilesView } from "./FilesView";
import { LogsView } from "./LogsView";
import { StatsView } from "./StatsView";
import { ContainerPane, InspectChild, INSPECT_CHILDREN, ProjectPane, SelectionPane } from "./views";

/** xterm is big: load it the first time a terminal opens (its own chunk). */
const TerminalView = lazy(() => import("./TerminalView").then((m) => ({ default: m.TerminalView })));

/** Children that are live views and can have their own window. */
const LIVE_CHILDREN: ChildId[] = ["logs", "terminal", "stats"];

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

const VERB_ICONS: Record<Verb, ReactNode> = {
  start: <PlayIcon />,
  stop: <StopIcon />,
  restart: <RestartIcon />,
  pause: <PauseIcon />,
  unpause: <PlayIcon />,
  kill: <StopIcon />,
  remove: <DeleteIcon />,
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

const isInContainer = (l: ContainersLoc | null): l is Extract<ContainersLoc, { name: string }> =>
  l !== null && (l.kind === "container" || l.kind === "child");

export function useContainersSection(shell: Shell): SectionUi {
  const { place, engine, copyText, showError, showFlash } = shell;
  const active = place.section === SECTION;
  const path = active ? place.path : "";
  const loc = active ? parseContainers(path) : null;
  const go = useCallback((p: string) => shell.navigate({ section: SECTION, path: p } satisfies Place), [shell]);
  const placeOf = (p: string): Place => ({ section: SECTION, path: p });

  const [open, setOpen] = useState(true);
  const { items, error, loading, refresh } = shell.containers;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Selection belongs to the path it was made in. */
  const [selection, setSelection] = useState({ path: "", keys: new Set<string>() });
  const selected = selection.path === path ? selection.keys : new Set<string>();
  const setSelected = (keys: Set<string>) => setSelection({ path, keys });
  const [inspected, setInspected] = useState<{ id: string; details: ContainerDetails | null; error: AppError | null } | null>(null);

  const connected = engine.status === "connected";


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
  const projectByName = useMemo(() => new Map(projects.map((p) => [p.name, p])), [projects]);

  const project = loc?.kind === "project" ? projectByName.get(loc.project) : undefined;
  const container = isInContainer(loc) ? byName.get(loc.name) : undefined;

  /** Containers a list key stands for (a project: all of its containers). */
  const containersOf = useCallback(
    (key: string): ContainerItem[] => {
      const l = parseContainers(key);
      if (l?.kind === "project") return projectByName.get(l.project)?.containers ?? [];
      if (l?.kind === "container") {
        const c = byName.get(l.name);
        return c ? [c] : [];
      }
      return [];
    },
    [byName, projectByName],
  );

  // What actions apply to: the selection, or the open container.
  const targets: ContainerItem[] = useMemo(() => {
    if (selected.size > 0) {
      const seen = new Map<string, ContainerItem>();
      for (const k of selected) for (const c of containersOf(k)) seen.set(c.id, c);
      return [...seen.values()];
    }
    return container ? [container] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, path, containersOf, container]);

  // Inspect the open container, or the single selected one (for the details
  // pane). Re-read when containers change.
  const single = selected.size === 1 ? [...selected][0] : null;
  const singleItem = single ? (parseContainers(single)?.kind === "container" ? containersOf(single)[0] : undefined) : undefined;
  const inspectId = (container ?? singleItem)?.id ?? null;
  useEffect(() => {
    if (!inspectId || !connected) return;
    let stale = false;
    const t = window.setTimeout(() => {
      engineApi
        .inspectContainer(inspectId)
        .then((details) => !stale && setInspected({ id: inspectId, details, error: null }))
        .catch((e) => !stale && setInspected({ id: inspectId, details: null, error: e as AppError }));
    }, 120);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [inspectId, connected, engine.changes.container]);
  const inspectedFor = (id: string | undefined) => (inspected && inspected.id === id ? inspected : null);

  // Opening something inside a project expands it in the tree.
  useEffect(() => {
    if (loc && loc.kind !== "root" && loc.project) {
      const p = loc.project;
      setExpanded((s) => (s.has(p) ? s : new Set([...s, p])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // ---------------------------------------------------------------------------
  // Actions

  async function run(verb: Verb, list: ContainerItem[], opts = { force: false, volumes: false }) {
    const todo = applicable(verb, list);
    if (todo.length === 0) return;
    shell.setWorking(working(verb, todo.length));
    try {
      const action = verb === "remove" ? { type: "remove" as const, ...opts } : { type: verb };
      const results = await engineApi.containerAction(
        todo.map((c) => c.id),
        action,
      );
      const failed = results.filter((r) => r.error);
      if (failed.length === 0) showFlash(summary(verb, results.length, 0));
      else {
        const name = (id: string) => todo.find((c) => c.id === id)?.name ?? id.slice(0, 12);
        showError({
          kind: "other",
          message: `${summary(verb, results.length - failed.length, failed.length)}. ${failed.map((f) => `${name(f.id)}: ${f.error}`).join(" ")}`,
          detail: "",
        });
      }
      // Deleting the open container leaves nothing to show: go up.
      if (verb === "remove" && container && !failed.some((f) => f.id === container.id) && todo.some((c) => c.id === container.id)) {
        go(container.project ? projectPath(container.project) : "");
      }
    } catch (e) {
      showError(e);
    } finally {
      shell.setWorking(null);
      refresh();
    }
  }

  async function kill(list: ContainerItem[]) {
    const todo = applicable("kill", list);
    if (todo.length === 0) return;
    const choice = await shell.ask(
      todo.length === 1 ? `Kill ${todo[0].name}?` : `Kill ${todo.length} containers?`,
      <>
        <p>Killing stops a container at once, without letting it shut down cleanly. Unsaved work in it is lost.</p>
        <NameList names={todo.map((c) => c.name)} />
      </>,
      [
        { label: "Kill", value: "kill", danger: true },
        { label: "Cancel", value: "cancel", primary: true },
      ],
      "cancel",
    );
    if (choice === "kill") await run("kill", todo);
  }

  async function remove(list: ContainerItem[]) {
    const todo = applicable("remove", list);
    if (todo.length === 0) return;
    const running = todo.filter((c) => c.state === "running" || c.state === "paused" || c.state === "restarting");
    const opts = { force: running.length > 0, volumes: false };
    const choice = await shell.ask(
      todo.length === 1 ? `Delete ${todo[0].name}?` : `Delete ${todo.length} containers?`,
      <>
        <p>Deleting a container removes it and its writable layer. Named volumes are kept.</p>
        <NameList names={todo.map((c) => c.name)} />
        {running.length > 0 && (
          <p className="warn-note">
            {running.length === 1 ? `${running[0].name} is running and will be stopped first.` : `${running.length} of these are running and will be stopped first.`}
          </p>
        )}
        <label className="check-row">
          <input type="checkbox" onChange={(e) => (opts.volumes = e.target.checked)} /> Also delete their anonymous volumes
        </label>
      </>,
      [
        { label: "Delete", value: "delete", danger: true },
        { label: "Cancel", value: "cancel", primary: true },
      ],
      "cancel",
    );
    if (choice === "delete") await run("remove", todo, opts);
  }

  const doVerb = (verb: Verb, list: ContainerItem[]) => {
    if (verb === "kill") void kill(list);
    else if (verb === "remove") void remove(list);
    else void run(verb, list);
  };
  const can = (verb: Verb) => applicable(verb, targets).length > 0;

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

  function verbItems(list: ContainerItem[]): MenuItem[] {
    const verbs: Verb[] = ["start", "stop", "restart", "pause", "unpause", "kill"];
    return verbs
      .filter((v) => applicable(v, list).length > 0)
      .map((v) => ({ label: v === "kill" ? "Kill…" : VERBS[v].label, onClick: () => doVerb(v, list) }));
  }

  function openContextMenu(key: string | null, x: number, y: number) {
    const menu: MenuItem[] = [];
    if (key) {
      // Right-clicking a selected row acts on the whole selection.
      const keys = selected.has(key) ? [...selected] : [key];
      const list = [...new Map(keys.flatMap(containersOf).map((c) => [c.id, c])).values()];
      if (keys.length === 1) {
        const l = parseContainers(key);
        menu.push(
          { label: "Open", bold: true, shortcut: "Enter", onClick: () => go(key) },
          { label: "Open in new tab", onClick: () => shell.openInNewTab(placeOf(key)) },
        );
        if (l?.kind === "child" && LIVE_CHILDREN.includes(l.child) && shell.popOut) {
          const popOut = shell.popOut;
          menu.push({ label: "Open in new window", onClick: () => popOut(placeOf(key)) });
        }
        if (l?.kind !== "child") menu.push("separator");
      }
      const verbs = verbItems(list);
      if (verbs.length) menu.push(...verbs, "separator");
      if (list.length) menu.push({ label: "Delete…", shortcut: "Del", onClick: () => void remove(list) }, "separator");
      const c = keys.length === 1 ? containersOf(key) : [];
      if (c.length === 1 && parseContainers(key)?.kind === "container")
        menu.push({ label: "Copy name", onClick: () => void copyText(c[0].name) }, { label: "Copy ID", onClick: () => void copyText(c[0].id) }, "separator");
    }
    menu.push({ label: "Refresh", shortcut: "F5", onClick: refresh });
    shell.openMenu(x, y, menu);
  }

  const idItem = singleItem ?? (selected.size === 0 && loc && isInContainer(loc) ? container : undefined);
  const commands = active ? (
    <>
      <CommandButton icon={<FolderIcon />} label="Open" title="Open the selected item (Enter)" disabled={!single} onClick={() => single && go(single)} />
      <CommandSeparator />
      {(["start", "stop", "restart"] as Verb[]).map((v) => (
        <CommandButton key={v} icon={VERB_ICONS[v]} label={VERBS[v].label} title={`${VERBS[v].label} the selected containers`} disabled={!can(v)} onClick={() => doVerb(v, targets)} />
      ))}
      {can("unpause") && !can("pause") ? (
        <CommandButton icon={VERB_ICONS.unpause} label="Resume" title="Resume the selected paused containers" onClick={() => doVerb("unpause", targets)} />
      ) : (
        <CommandButton icon={VERB_ICONS.pause} label="Pause" title="Pause the selected containers" disabled={!can("pause")} onClick={() => doVerb("pause", targets)} />
      )}
      <CommandSeparator />
      <CommandButton icon={<DeleteIcon />} label="Delete" title="Delete the selected containers (Del)" disabled={!can("remove")} onClick={() => void remove(targets)} />
      <CommandButton icon={<CopyIcon />} label="Copy ID" title="Copy the container's full ID" disabled={!idItem} onClick={() => idItem && void copyText(idItem.id)} />
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
        selected={active && isInContainer(loc) && loc.name === c.name}
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
  // Content, details pane and status

  let content: ReactNode = null;
  let status = "";
  let details: ReactNode = undefined;
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
        view={shell.view}
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
      status = `${container.name} · ${child.name}`;
      if (INSPECT_CHILDREN.includes(loc.child)) {
        const ins = inspectedFor(container.id);
        content = ins?.error ? (
          <ErrorPanel error={ins.error} onRetry={refresh} />
        ) : ins?.details ? (
          <InspectChild child={loc.child as "env"} details={ins.details} onError={showError} onCopied={() => showFlash("Copied the value")} />
        ) : (
          <div className="empty-note">Loading…</div>
        );
      } else {
        const popOut = shell.popOut ? () => shell.popOut!(placeOf(path)) : undefined;
        if (loc.child === "logs") content = <LogsView key={container.id} sources={[{ container, label: container.name }]} exportName={container.name} shell={shell} onPopOut={popOut} />;
        else if (loc.child === "terminal")
          content = (
            <Suspense fallback={<div className="empty-note">Loading the terminal…</div>}>
              <TerminalView key={container.id} container={container} onPopOut={popOut} />
            </Suspense>
          );
        else if (loc.child === "stats") content = <StatsView key={container.id} container={container} onPopOut={popOut} />;
        else if (loc.child === "files") {
          const where = loc;
          content = (
            <FilesView
              key={container.id}
              container={container}
              dir={`/${where.rest}`}
              shell={shell}
              openDir={(abs) => go(formatContainers({ ...where, rest: abs.replace(/^\/+/, "") }))}
            />
          );
          status = `${container.name} · /${where.rest}`;
        } else content = <div className="empty-note center">The {child.name.toLowerCase()} view isn't built yet.</div>;
      }
    }
    if (selected.size > 1) status += ` · ${selected.size} selected`;

    // Details pane: the selection, else the open container or project.
    if (selected.size === 1 && single) {
      const l = parseContainers(single);
      if (l?.kind === "project" && projectByName.get(l.project)) details = <ProjectPane name={l.project} containers={projectByName.get(l.project)!.containers} />;
      else if (singleItem) details = <ContainerPane item={singleItem} details={inspectedFor(singleItem.id)?.details ?? null} />;
    } else if (selected.size > 1 && targets.length > 0) {
      details = <SelectionPane items={targets} />;
    } else if (container) {
      details = <ContainerPane item={container} details={inspectedFor(container.id)?.details ?? null} />;
    } else if (project) {
      details = <ProjectPane name={project.name} containers={project.containers} />;
    }
  }

  return {
    tree,
    content,
    commands,
    status,
    busy: active && loading,
    refresh,
    dialogs: null,
    details,
    onDelete: targets.length ? () => void remove(targets) : undefined,
  };
}

function NameList({ names }: { names: string[] }) {
  const shown = names.slice(0, 12);
  return (
    <ul className="name-list">
      {shown.map((n) => (
        <li key={n}>{n}</li>
      ))}
      {names.length > shown.length && <li>and {(names.length - shown.length).toLocaleString()} more</li>}
    </ul>
  );
}
