// Compose: projects that are running (from container labels) or pinned (a
// compose file chosen by the user, so the project shows while it's down).
// Up / stop / restart / pull / down run `docker compose` in WSL or on the
// host (Settings), with the output shown as it runs. A project's Logs merge
// every service's logs in time order. Compose files or folders dropped on
// the window (anywhere but container Files) are confirmed, pinned and brought up.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { appApi } from "../../api/app";
import { composeApi, COMPOSE_DISTRO_KEY, type ComposeTarget, type ComposeVerb, type DropGroup, type UnnamedVolume } from "../../api/compose";
import { Board, type BoardAction } from "../../components/Board";
import { CommandButton, CommandSeparator } from "../../components/CommandButton";
import type { MenuItem } from "../../components/ContextMenu";
import { ErrorPanel } from "../../components/ErrorPanel";
import { FileList, type Column, type Row } from "../../components/FileList";
import { ContainerIcon, DeleteIcon, EditIcon, FileIcon, DownloadIcon, LogsIcon, NewItemIcon, PlayIcon, ProjectIcon, RefreshIcon, RestartIcon, StopIcon, VolumeIcon } from "../../components/Icons";
import { TreeMore, TreeNote, TreeRow } from "../../components/TreeRow";
import { partition } from "../../status/filter";
import type { SectionUi, Shell } from "../../shell/shell";
import { NameList, PropsTable } from "../common";
import { containerPath } from "../containers/paths";
import { LogsView } from "../containers/LogsView";
import { ComposeFileView } from "./ComposeFileView";
import { DropComposeDialog } from "./DropComposeDialog";
import { NameVolumesDialog } from "./NameVolumesDialog";
import { fileName, parentDir, pinnedLabel, projectsFrom, projectState, targetOf, windowsPath, type Project } from "./projects";
import { RunDialog } from "./RunDialog";
import { attention, containerStatus, projectStatus } from "../../status/status";
import { SectionBadge } from "../../components/SectionBadge";
import { StatusMark } from "../../components/StatusMark";
import { portsCell } from "../containers/ports";
import { anonymousCount } from "../volumes/anonymous";
import { unnamedKey, UnnamedNotes, unnamedRows, UNNAMED_COLUMNS, useUnnamedVolumes } from "./unnamedVolumes";

const SECTION = "compose";
const NAME = /^[a-z0-9][a-z0-9_-]*$/;

/** A project's children: merged logs, its compose files, its unnamed volumes. */
const CHILDREN = { logs: "Logs", file: "Compose file", volumes: "Unnamed volumes" } as const;
type Child = keyof typeof CHILDREN;

export const composePaths = {
  crumbs: (path: string) => {
    const [name, child] = path.split("/");
    if (!name) return [];
    const label = CHILDREN[child as Child];
    return [{ label: name, path: name }, ...(label ? [{ label, path: `${name}/${child}` }] : [])];
  },
  parent: (path: string) => (path.includes("/") ? path.split("/")[0] : null),
  isPath: (path: string) => {
    const [name, child, ...rest] = path.split("/");
    return NAME.test(name) && (child === undefined || child in CHILDREN) && rest.length === 0;
  },
};

const COLUMNS: Column[] = [
  { id: "name", label: "Name", width: 200 },
  { id: "state", label: "State", width: 130 },
  { id: "services", label: "Services", width: 220 },
  { id: "folder", label: "Folder", width: 340 },
  { id: "source", label: "Shown because", width: 140 },
];

const SERVICE_COLUMNS: Column[] = [
  { id: "name", label: "Name", width: 220 },
  { id: "state", label: "State", width: 110 },
  { id: "service", label: "Service", width: 120 },
  { id: "image", label: "Image", width: 200 },
  { id: "status", label: "Status", width: 170 },
  { id: "ports", label: "Ports", width: 160 },
];

const VERBS: Record<ComposeVerb, { label: string; doing: string }> = {
  up: { label: "Up", doing: "docker compose up -d" },
  stop: { label: "Stop", doing: "docker compose stop" },
  start: { label: "Start", doing: "docker compose start" },
  restart: { label: "Restart", doing: "docker compose restart" },
  pull: { label: "Pull", doing: "docker compose pull" },
  down: { label: "Down", doing: "docker compose down" },
  "down-volumes": { label: "Down", doing: "docker compose down --volumes" },
};

export function useComposeSection(shell: Shell): SectionUi {
  const { place, engine } = shell;
  const active = place.section === SECTION;
  const path = active ? place.path : "";
  const [projectName, child] = path.split("/");
  const go = useCallback((p: string) => shell.navigate({ section: SECTION, path: p }), [shell]);

  // Pinned files live in the shell: volumes and networks need them too.
  const pinned = shell.composePinned;
  const setPinned = shell.setComposePinned;
  const [distro, setDistro] = useState("");
  const [open, setOpen] = useState(true);
  /**
   * A run in progress, with its own id (the Run dialog's key, so a new run
   * never shows in an old one's dialog); openAfter: go to the project when
   * it succeeds (drops).
   */
  const [running, setRunning] = useState<{ id: number; project: Project; verb: ComposeVerb; openAfter?: boolean } | null>(null);
  const runIds = useRef(0);
  const startRun = (r: { project: Project; verb: ComposeVerb; openAfter?: boolean }) => setRunning({ ...r, id: ++runIds.current });
  /**
   * Dropped projects waiting to be confirmed, one at a time; skipped: why
   * dropped folders that can't be used were left out (shown in the first).
   */
  const [drops, setDrops] = useState<{ groups: DropGroup[]; at: number; skipped: string[] } | null>(null);
  /** The Name volumes dialog: the project's files and findings when it opened. */
  const [naming, setNaming] = useState<{ project: string; target: ComposeTarget; findings: UnnamedVolume[] } | null>(null);
  /** A confirmed drop is being pinned: its up hasn't started yet. */
  const [pinning, setPinning] = useState(false);
  const [selection, setSelection] = useState({ path: "", keys: new Set<string>() });
  const selected = selection.path === path ? selection.keys : new Set<string>();
  const setSelected = (keys: Set<string>) => setSelection({ path, keys });

  // Pinned files and the WSL distro (for showing WSL paths as Windows ones).
  const loadPinned = useCallback(() => {
    composeApi
      .pinned()
      .then(setPinned)
      .catch(() => {});
    // The chosen distro, else WSL's default one.
    Promise.all([appApi.getSettings(), composeApi.distros().catch(() => [])])
      .then(([s, distros]) => {
        const chosen = typeof s.values[COMPOSE_DISTRO_KEY] === "string" ? (s.values[COMPOSE_DISTRO_KEY] as string) : "";
        setDistro(chosen || distros.find((d) => d.default)?.name || "");
      })
      .catch(() => {});
  }, []);
  useEffect(loadPinned, [loadPinned]);

  const projects = useMemo(() => projectsFrom(shell.containers.items ?? [], pinned), [shell.containers.items, pinned]);
  const byName = useMemo(() => new Map(projects.map((p) => [p.name, p])), [projects]);
  const statusOf = (p: Project) => projectStatus(p.containers, p.pinned !== null);
  // Show level: the open project always shows; "+ n more" reveals the rest.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => setRevealed(false), [shell.treeLevel]);
  const treeProjects = partition(projects, statusOf, revealed ? "all" : shell.treeLevel, (p) => p.name === projectName);
  const sectionAttention = useMemo(() => ({ ...attention(projects.map((p) => projectStatus(p.containers, p.pinned !== null))), orphans: 0 }), [projects]);
  const current = projectName ? byName.get(projectName) : undefined;
  const single = selected.size === 1 && !projectName ? byName.get([...selected][0]) : undefined;
  const target = single ?? current;
  const shown = (p: string) => windowsPath(p, distro);
  const unnamed = useUnnamedVolumes(engine, current && child === "volumes" ? targetOf(current) : null);

  function refresh() {
    shell.containers.refresh();
    loadPinned();
    if (child === "volumes") unnamed.refresh();
  }

  // ---------------------------------------------------------------------------
  // Actions

  async function down(p: Project) {
    const choice = await shell.ask(
      `Take ${p.name} down?`,
      <>
        <p>Down stops and removes the project's containers and networks. Named volumes are kept unless you choose to delete them too.</p>
        <NameList names={p.containers.map((c) => c.name)} />
      </>,
      [
        { label: "Down", value: "down", primary: true },
        { label: "Down and delete volumes…", value: "volumes", danger: true },
        { label: "Cancel", value: "cancel" },
      ],
      "cancel",
    );
    if (choice === "down") startRun({ project: p, verb: "down" });
    else if (choice === "volumes") {
      const ok = await shell.confirmTyped(
        `Delete ${p.name}'s volumes?`,
        <p>Down with volumes also deletes the volumes the project declares, and the data in them. There's no undo.</p>,
        p.name,
        "Down and delete",
      );
      if (ok) startRun({ project: p, verb: "down-volumes" });
    }
  }

  async function pin() {
    try {
      const file = await appApi.pickOpenFile("Pin a compose file", "Compose files", ["yml", "yaml"]);
      if (!file) return;
      shell.setWorking("Reading the compose file…");
      const list = await composeApi.pin([file]);
      setPinned(list);
      const added = list.find((p) => p.files.includes(file));
      shell.showFlash(added ? `Pinned ${added.name}` : "Pinned");
    } catch (e) {
      shell.showError(e);
    } finally {
      shell.setWorking(null);
    }
  }

  async function unpin(p: Project) {
    try {
      setPinned(await composeApi.unpin(p.name));
      shell.showFlash(`Unpinned ${p.name}`);
      if (current === p && p.containers.length === 0) go("");
    } catch (e) {
      shell.showError(e);
    }
  }

  // Dropped files and folders: Rust groups them by folder and offers the
  // files; each group is confirmed in turn, then pinned and brought up. The
  // next one waits until the last one's up has finished (and while one is
  // waiting or running, new drops are ignored).
  async function fileDrop(paths: string[]) {
    if (drops || pinning || running) return;
    shell.setWorking("Reading the dropped files…");
    try {
      const groups = await composeApi.dropCandidates(paths);
      const ok = groups.filter((g) => !g.error);
      const skipped = groups.flatMap((g) => (g.error ? [g.error] : []));
      // Folders that can't be used show in the first confirm, not a second dialog.
      if (ok.length) setDrops({ groups: ok, at: 0, skipped });
      else shell.showError({ message: skipped.join(" ") });
    } catch (e) {
      shell.showError(e);
    } finally {
      shell.setWorking(null);
    }
  }

  const nextDrop = () => setDrops((d) => (d && d.at + 1 < d.groups.length ? { ...d, at: d.at + 1 } : null));

  async function startDropped(files: string[]) {
    // Hide this confirm without showing the next until this project's up is
    // under way (the next shows once its Run dialog closes).
    setPinning(true);
    shell.setWorking("Pinning the compose files…");
    try {
      const list = await composeApi.pin(files);
      setPinned(list);
      const pin = list.find((p) => p.files.length === files.length && p.files.every((f, i) => f === files[i]));
      if (pin) {
        const known = byName.get(pin.name);
        const project: Project = { name: pin.name, dir: parentDir(files[0]), files, containers: known?.containers ?? [], running: known?.running ?? 0, pinned: pin };
        startRun({ project, verb: "up", openAfter: true });
      }
    } catch (e) {
      shell.showError(e);
    } finally {
      shell.setWorking(null);
      setPinning(false);
      nextDrop();
    }
  }

  const run = (verb: ComposeVerb, p: Project | undefined) => p && startRun({ project: p, verb });
  const canRun = (p: Project | undefined) => !!p && (p.files.length > 0 || p.pinned !== null || p.containers.length > 0);

  // ---------------------------------------------------------------------------
  // Rows, menus, commands

  const projectRows: Row[] = projects.map((p) => ({
    key: p.name,
    icon: <ProjectIcon />,
    isContainer: true,
    status: statusOf(p),
    cells: {
      name: { text: p.name, sort: p.name },
      state: { text: statusOf(p).label, sort: p.containers.length ? p.running - p.containers.length : 1 },
      services: { text: [...new Set(p.containers.map((c) => c.service ?? c.name))].join(", "), sort: p.containers.length },
      folder: { text: p.pinned ? pinnedLabel(p.pinned) : shown(p.dir), sort: p.dir },
      source: { text: p.pinned && p.containers.length ? "Pinned, running" : p.pinned ? "Pinned" : "Running", sort: p.pinned ? 0 : 1 },
    },
  }));

  const serviceRows: Row[] = current
    ? [
        {
          key: `${current.name}/logs`,
          icon: <LogsIcon />,
          isContainer: true,
          cells: { name: { text: "Logs", sort: "" }, state: { text: "", sort: "" }, service: { text: "Every service, merged", sort: "" }, image: { text: "", sort: "" }, status: { text: "", sort: "" }, ports: { text: "", sort: "" } },
        },
        {
          key: `${current.name}/file`,
          icon: <FileIcon />,
          isContainer: true,
          cells: {
            name: { text: "Compose file", sort: " " },
            state: { text: "", sort: "" },
            service: { text: targetOf(current).files.map(fileName).join(", ") || "Not recorded", sort: "" },
            image: { text: "", sort: "" },
            status: { text: "", sort: "" },
            ports: { text: "", sort: "" },
          },
        },
        {
          key: `${current.name}/volumes`,
          icon: <VolumeIcon />,
          isContainer: true,
          cells: {
            name: { text: "Unnamed volumes", sort: "  " },
            state: { text: "", sort: "" },
            service: { text: unnamedSummary(anonymousCount(current.containers)), sort: "" },
            image: { text: "", sort: "" },
            status: { text: "", sort: "" },
            ports: { text: "", sort: "" },
          },
        },
        ...current.containers.map((c) => ({
          key: `c:${c.name}`,
          icon: <ContainerIcon />,
          isContainer: false,
          status: containerStatus(c),
          cells: {
            name: { text: c.name, sort: c.name },
            state: { text: containerStatus(c).label, sort: c.state },
            service: { text: c.service ?? "", sort: c.service ?? "" },
            image: { text: c.image, sort: c.image },
            status: { text: c.status, sort: c.status },
            ports: portsCell(c),
          },
        })),
      ]
    : [];

  function openRow(key: string) {
    if (key.startsWith("c:")) {
      const c = current?.containers.find((x) => x.name === key.slice(2));
      if (c) shell.navigate({ section: "containers", path: containerPath(c.project, c.name) });
    } else go(key);
  }

  // Unnamed volumes: open the volume a container holds, or the container.
  const findingOf = (key: string) => unnamed.data?.findings.find((f) => unnamedKey(f) === key);
  // Naming them edits files: main window only, like the project's other actions.
  const canName = !!shell.popOut && !!current && !!unnamed.data?.findings.length;
  function openNaming() {
    if (!canName || !current || !unnamed.data) return;
    setNaming({ project: current.name, target: targetOf(current), findings: unnamed.data.findings });
  }
  function openUnnamed(key: string) {
    const v = findingOf(key)?.current[0];
    if (v) shell.navigate({ section: "volumes", path: v.volume });
  }
  function unnamedMenu(key: string | null, x: number, y: number) {
    const f = key ? findingOf(key) : undefined;
    const menu: MenuItem[] = [];
    if (key && f) {
      const c = f.current[0] && current?.containers.find((x) => x.name === f.current[0].container);
      menu.push(
        { label: "Open volume", bold: true, shortcut: "Enter", disabled: !f.current.length, onClick: () => openUnnamed(key) },
        { label: "Open container", disabled: !c, onClick: () => c && shell.navigate({ section: "containers", path: containerPath(c.project, c.name) }) },
        "separator",
        { label: "Copy proposed name", onClick: () => void shell.copyText(f.name) },
        ...(f.current.length ? [{ label: "Copy volume name", onClick: () => void shell.copyText(f.current[0].volume) }] : []),
        "separator",
      );
    }
    if (shell.popOut) menu.push({ label: "Name volumes…", disabled: !canName, onClick: openNaming });
    menu.push({ label: "Refresh", shortcut: "F5", onClick: refresh });
    shell.openMenu(x, y, menu);
  }

  function verbItems(p: Project): MenuItem[] {
    const ok = canRun(p);
    return [
      { label: "Up", onClick: () => run("up", p), disabled: !ok },
      { label: "Stop", onClick: () => run("stop", p), disabled: p.running === 0 },
      { label: "Restart", onClick: () => run("restart", p), disabled: p.containers.length === 0 },
      { label: "Pull images", onClick: () => run("pull", p), disabled: !ok },
      { label: "Down…", onClick: () => void down(p), disabled: p.containers.length === 0 },
    ];
  }

  function openMenu(key: string | null, x: number, y: number) {
    const menu: MenuItem[] = [];
    const p = key && !key.startsWith("c:") && !key.includes("/") ? byName.get(key) : current;
    if (key && key.startsWith("c:")) menu.push({ label: "Open container", bold: true, onClick: () => openRow(key) }, "separator");
    else if (key && p) {
      if (!projectName) menu.push({ label: "Open", bold: true, shortcut: "Enter", onClick: () => go(p.name) }, { label: "Open in new tab", onClick: () => shell.openInNewTab({ section: SECTION, path: p.name }) });
      menu.push(
        { label: "Logs", onClick: () => go(`${p.name}/logs`) },
        { label: "Compose file", onClick: () => go(`${p.name}/file`) },
        { label: "Unnamed volumes", onClick: () => go(`${p.name}/volumes`) },
        "separator",
        ...verbItems(p),
        "separator",
      );
      menu.push(p.pinned ? { label: "Unpin", onClick: () => void unpin(p) } : { label: "Pin this project's compose file…", onClick: () => void pin() }, "separator");
    } else menu.push({ label: "Pin a compose file…", onClick: () => void pin() }, "separator");
    menu.push({ label: "Refresh", shortcut: "F5", onClick: refresh });
    shell.openMenu(x, y, menu);
  }

  const commands = active ? (
    <>
      <CommandButton icon={<PlayIcon />} label="Up" title="docker compose up -d" disabled={!canRun(target)} onClick={() => run("up", target)} />
      <CommandButton icon={<StopIcon />} label="Stop" title="docker compose stop" disabled={!target || target.running === 0} onClick={() => run("stop", target)} />
      <CommandButton icon={<RestartIcon />} label="Restart" title="docker compose restart" disabled={!target || target.containers.length === 0} onClick={() => run("restart", target)} />
      <CommandButton icon={<DownloadIcon />} label="Pull" title="docker compose pull" disabled={!canRun(target)} onClick={() => run("pull", target)} />
      <CommandButton icon={<DeleteIcon />} label="Down…" title="docker compose down" disabled={!target || target.containers.length === 0} onClick={() => target && void down(target)} />
      <CommandSeparator />
      <CommandButton icon={<LogsIcon />} label="Logs" title="Every service's logs, merged" disabled={!target || target.containers.length === 0} onClick={() => target && go(`${target.name}/logs`)} />
      <CommandButton icon={<FileIcon />} label="File" title="The project's compose files, and the resolved config" disabled={!target} onClick={() => target && go(`${target.name}/file`)} />
      <CommandButton icon={<VolumeIcon />} label="Unnamed" title="Volumes Docker makes for the project with no name" disabled={!target} onClick={() => target && go(`${target.name}/volumes`)} />
      {child === "volumes" && shell.popOut && (
        <CommandButton icon={<EditIcon />} label="Name volumes…" title="Name these volumes in the compose files" disabled={!canName} onClick={openNaming} />
      )}
      <CommandButton icon={<NewItemIcon />} label="Pin file…" title="Pin a compose file so its project shows while it's down" onClick={() => void pin()} />
      <CommandSeparator />
      <CommandButton icon={<RefreshIcon />} label="Refresh" title="Refresh (F5)" onClick={refresh} />
    </>
  ) : null;

  // ---------------------------------------------------------------------------
  // Tree, content, details

  const tree = (
    <TreeRow
      depth={1}
      label="Compose"
      icon={<ProjectIcon />}
      badge={<SectionBadge {...sectionAttention} />}
      selected={active && !projectName}
      expanded={open}
      onClick={() => go("")}
      onToggle={() => {
        if (open) setRevealed(false);
        setOpen((v) => !v);
      }}
    >
      {shell.containers.items === null ? (
        <TreeNote depth={2}>{engine.status === "connected" ? "Loading…" : "Not connected"}</TreeNote>
      ) : projects.length === 0 ? (
        <TreeNote depth={2}>No projects</TreeNote>
      ) : (
        <>
          {treeProjects.shown.map((p) => (
            <TreeRow
              key={p.name}
              depth={2}
              label={p.name}
              icon={<ProjectIcon />}
              status={statusOf(p)}
              selected={active && projectName === p.name}
              onClick={() => go(p.name)}
              onContextMenu={(x, y) => openMenu(p.name, x, y)}
            />
          ))}
          {treeProjects.summary && (
            <TreeMore depth={2} onClick={() => setRevealed(true)}>
              {treeProjects.summary}
            </TreeMore>
          )}
        </>
      )}
    </TreeRow>
  );

  // Dashboard cards: Up or Stop, and Logs; the rest under More.
  function cardActions(key: string): BoardAction[] {
    const p = byName.get(key);
    if (!p) return [];
    const out: BoardAction[] = [];
    if (p.containers.length === 0 || p.running < p.containers.length) out.push({ label: "Up", icon: <PlayIcon />, disabled: !canRun(p), onClick: () => run("up", p) });
    if (p.running > 0) out.push({ label: "Stop", icon: <StopIcon />, onClick: () => run("stop", p) });
    out.push({ label: "Logs", icon: <LogsIcon />, disabled: p.containers.length === 0, onClick: () => go(`${p.name}/logs`) });
    return out;
  }

  let content: ReactNode = null;
  let board: ReactNode = undefined;
  let status = "";
  if (active) {
    const list = shell.containers;
    if (list.error) content = <ErrorPanel error={list.error} onRetry={refresh} />;
    else if (list.items === null) content = <div className="empty-note">{engine.status === "connected" ? "Loading…" : engine.message || "Not connected to the engine."}</div>;
    else if (!projectName) {
      content = (
        <FileList
          columnsKey="compose"
          columns={COLUMNS}
          rows={projectRows}
          selected={selected}
          onSelectionChange={setSelected}
          onOpen={go}
          onContextMenu={openMenu}
          emptyText="No compose projects. Projects you start show up here; use Pin file… to keep one listed while it's down."
          view={shell.view}
        />
      );
      board = (
        <Board
          layout="cards"
          columns={COLUMNS}
          rows={projectRows}
          selected={selected}
          onSelectionChange={setSelected}
          onOpen={go}
          onMenu={openMenu}
          actions={cardActions}
          emptyText="No compose projects. Projects you start show up here; use Pin file… to keep one listed while it's down."
        />
      );
      const up = projects.filter((p) => p.running > 0).length;
      status = `${projects.length.toLocaleString()} projects · ${up.toLocaleString()} running`;
    } else if (!current) {
      content = <ErrorPanel error={{ kind: "notFound", message: `There's no compose project called ${projectName}. Pin its compose file to work with it while it's down.`, detail: "" }} />;
    } else if (child === "logs") {
      content =
        current.containers.length === 0 ? (
          <div className="empty-note center">{current.name} has no containers. Bring it up to see logs.</div>
        ) : (
          <LogsView
            key={current.name}
            sources={current.containers.map((c) => ({ container: c, label: c.service ?? c.name }))}
            exportName={current.name}
            shell={shell}
            onPopOut={shell.popOut ? () => shell.popOut!({ section: SECTION, path }) : undefined}
          />
        );
      status = `${current.name} · Logs from ${current.containers.length} containers`;
    } else if (child === "file") {
      const t = targetOf(current);
      content = <ComposeFileView key={`${current.name}:${t.files.join("|")}`} target={t} shown={shown} shell={shell} />;
      status = `${current.name} · ${t.files.length === 1 ? "1 compose file" : `${t.files.length} compose files`}`;
    } else if (child === "volumes") {
      if (unnamed.error) content = <ErrorPanel error={unnamed.error} onRetry={unnamed.refresh} />;
      else if (!unnamed.data) content = <div className="empty-note">{engine.status === "connected" ? "Reading the project's volumes…" : "Not connected"}</div>;
      else {
        const rows = unnamedRows(unnamed.data.findings);
        const empty = "No unnamed volumes: every volume in this project has a name.";
        content = (
          <div className="section-pane">
            <UnnamedNotes data={unnamed.data} />
            <FileList
              key={path}
              columnsKey="compose.volumes"
              columns={UNNAMED_COLUMNS}
              rows={rows}
              selected={selected}
              onSelectionChange={setSelected}
              onOpen={openUnnamed}
              onContextMenu={unnamedMenu}
              emptyText={empty}
              view={shell.view}
            />
          </div>
        );
        board = (
          <div className="section-pane">
            <UnnamedNotes data={unnamed.data} />
            <Board
              columns={UNNAMED_COLUMNS}
              rows={rows}
              selected={selected}
              onSelectionChange={setSelected}
              onOpen={openUnnamed}
              onMenu={unnamedMenu}
              actions={(k) => [{ label: "Open volume", icon: <VolumeIcon />, disabled: !findingOf(k)?.current.length, onClick: () => openUnnamed(k) }]}
              emptyText={empty}
            />
          </div>
        );
        const n = unnamed.data.findings.length;
        status = `${current.name} · ${n === 1 ? "1 unnamed volume" : `${n.toLocaleString()} unnamed volumes`}`;
      }
    } else {
      content = (
        <FileList
          key={path}
          columnsKey="compose.project"
          columns={SERVICE_COLUMNS}
          rows={serviceRows}
          selected={selected}
          onSelectionChange={setSelected}
          onOpen={openRow}
          onContextMenu={openMenu}
          emptyText=""
          view={shell.view}
        />
      );
      status = `${current.name} · ${projectState(current)}`;
    }
  }

  const paneProject = single ?? current;
  const details = paneProject ? (
    <>
      <div className="details-head">
        <span className="fl-icon">
          <ProjectIcon />
        </span>
        <div>
          <div className="details-title">{paneProject.name}</div>
          <div className="details-sub">
            <StatusMark status={statusOf(paneProject)} /> {statusOf(paneProject).reason}
          </div>
        </div>
      </div>
      <PropsTable
        rows={[
          ["Folder", <span className="mono">{shown(targetOf(paneProject).dir)}</span>],
          ["Files", <span className="mono">{targetOf(paneProject).files.map(shown).join(", ")}</span>],
          ["Services", [...new Set(paneProject.containers.map((c) => c.service).filter(Boolean))].join(", ")],
          ["Pinned", paneProject.pinned ? "Yes" : ""],
          ["Unnamed volumes", anonymousCount(paneProject.containers) ? unnamedSummary(anonymousCount(paneProject.containers)) : ""],
        ]}
      />
    </>
  ) : undefined;

  const dialogs = running ? (
    <RunDialog
      key={running.id}
      title={`${VERBS[running.verb].doing} · ${running.project.name}`}
      target={targetOf(running.project)}
      verb={running.verb}
      onClose={(ok) => {
        const r = running;
        setRunning(null);
        if (ok) shell.showFlash(`${VERBS[r.verb].label}: ${r.project.name} done`);
        if (ok && r.openAfter) go(r.project.name);
        refresh();
      }}
    />
  ) : naming ? (
    <NameVolumesDialog
      project={naming.project}
      target={naming.target}
      findings={naming.findings}
      shown={shown}
      shell={shell}
      onSaved={() => {
        setNaming(null);
        refresh();
      }}
      onClose={() => setNaming(null)}
    />
  ) : drops && !pinning ? (
    <DropComposeDialog
      key={`${drops.at}:${drops.groups[drops.at].dir}`}
      group={drops.groups[drops.at]}
      index={drops.at + 1}
      count={drops.groups.length}
      skipped={drops.at === 0 ? drops.skipped : []}
      projects={byName}
      shown={shown}
      onStart={(files) => void startDropped(files)}
      onCancel={nextDrop}
    />
  ) : null;

  return {
    tree,
    content,
    board,
    commands,
    status,
    busy: active && shell.containers.loading,
    refresh,
    dialogs,
    details,
    act: (name: string, verb: string) => {
      const p = byName.get(name);
      if (!p || !canRun(p)) return;
      if (verb === "down") void down(p);
      else if (["up", "stop", "start", "restart", "pull"].includes(verb)) run(verb as ComposeVerb, p);
    },
    attention: sectionAttention,
    fileDrop: (paths: string[]) => void fileDrop(paths),
    placeStatus: (p: string) => {
      const pr = byName.get(p.split("/")[0]);
      return pr ? statusOf(pr) : undefined;
    },
  };
}

/** "2 in use", from the containers (the view also finds ones not made yet). */
const unnamedSummary = (n: number) => (n === 0 ? "None in use" : `${n.toLocaleString()} in use`);
