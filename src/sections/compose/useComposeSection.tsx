// Compose: projects that are running (from container labels) or pinned (a
// compose file chosen by the user, so the project shows while it's down).
// Up / stop / restart / pull / down run `docker compose` in WSL or on the
// host (Settings), with the output shown as it runs. A project's Logs merge
// every service's logs in time order.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { appApi } from "../../api/app";
import { composeApi, COMPOSE_DISTRO_KEY, type ComposeVerb } from "../../api/compose";
import { CommandButton, CommandSeparator } from "../../components/CommandButton";
import type { MenuItem } from "../../components/ContextMenu";
import { ErrorPanel } from "../../components/ErrorPanel";
import { FileList, type Column, type Row } from "../../components/FileList";
import { ContainerIcon, DeleteIcon, DownloadIcon, LogsIcon, NewItemIcon, PlayIcon, ProjectIcon, RefreshIcon, RestartIcon, StopIcon } from "../../components/Icons";
import { TreeNote, TreeRow } from "../../components/TreeRow";
import type { SectionUi, Shell } from "../../shell/shell";
import { NameList, PropsTable } from "../common";
import { containerPath } from "../containers/paths";
import { LogsView } from "../containers/LogsView";
import { projectsFrom, projectState, targetOf, windowsPath, type Project } from "./projects";
import { RunDialog } from "./RunDialog";
import { attention, containerStatus, projectStatus } from "../../status/status";
import { SectionBadge } from "../../components/SectionBadge";
import { StatusMark } from "../../components/StatusMark";

const SECTION = "compose";
const NAME = /^[a-z0-9][a-z0-9_-]*$/;

export const composePaths = {
  crumbs: (path: string) => {
    const [name, child] = path.split("/");
    if (!name) return [];
    return [{ label: name, path: name }, ...(child === "logs" ? [{ label: "Logs", path: `${name}/logs` }] : [])];
  },
  parent: (path: string) => (path.includes("/") ? path.split("/")[0] : null),
  isPath: (path: string) => {
    const [name, child, ...rest] = path.split("/");
    return NAME.test(name) && (child === undefined || child === "logs") && rest.length === 0;
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
  const [running, setRunning] = useState<{ project: Project; verb: ComposeVerb } | null>(null);
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
  const sectionAttention = useMemo(() => ({ ...attention(projects.map((p) => projectStatus(p.containers, p.pinned !== null))), orphans: 0 }), [projects]);
  const current = projectName ? byName.get(projectName) : undefined;
  const single = selected.size === 1 && !projectName ? byName.get([...selected][0]) : undefined;
  const target = single ?? current;
  const shown = (p: string) => windowsPath(p, distro);

  function refresh() {
    shell.containers.refresh();
    loadPinned();
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
    if (choice === "down") setRunning({ project: p, verb: "down" });
    else if (choice === "volumes") {
      const ok = await shell.confirmTyped(
        `Delete ${p.name}'s volumes?`,
        <p>Down with volumes also deletes the volumes the project declares, and the data in them. There's no undo.</p>,
        p.name,
        "Down and delete",
      );
      if (ok) setRunning({ project: p, verb: "down-volumes" });
    }
  }

  async function pin() {
    try {
      const file = await appApi.pickOpenFile("Pin a compose file", "Compose files", ["yml", "yaml"]);
      if (!file) return;
      shell.setWorking("Reading the compose file…");
      const list = await composeApi.pin(file);
      setPinned(list);
      const added = list.find((p) => p.file === file);
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

  const run = (verb: ComposeVerb, p: Project | undefined) => p && setRunning({ project: p, verb });
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
      folder: { text: p.pinned ? p.pinned.file : shown(p.dir), sort: p.dir },
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
            ports: { text: c.ports.join(", "), sort: c.ports.join(",") },
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
      menu.push({ label: "Logs", onClick: () => go(`${p.name}/logs`) }, "separator", ...verbItems(p), "separator");
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
      onToggle={() => setOpen((v) => !v)}
    >
      {shell.containers.items === null ? (
        <TreeNote depth={2}>{engine.status === "connected" ? "Loading…" : "Not connected"}</TreeNote>
      ) : projects.length === 0 ? (
        <TreeNote depth={2}>No projects</TreeNote>
      ) : (
        projects.map((p) => (
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
        ))
      )}
    </TreeRow>
  );

  let content: ReactNode = null;
  let status = "";
  if (active) {
    const list = shell.containers;
    if (list.error) content = <ErrorPanel error={list.error} onRetry={refresh} />;
    else if (list.items === null) content = <div className="empty-note">{engine.status === "connected" ? "Loading…" : engine.message || "Not connected to the engine."}</div>;
    else if (!projectName) {
      content = (
        <FileList
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
    } else {
      content = (
        <FileList
          key={path}
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
        ]}
      />
    </>
  ) : undefined;

  const dialogs = running ? (
    <RunDialog
      title={`${VERBS[running.verb].doing} · ${running.project.name}`}
      target={targetOf(running.project)}
      verb={running.verb}
      onClose={(ok) => {
        const r = running;
        setRunning(null);
        if (ok) shell.showFlash(`${VERBS[r.verb].label}: ${r.project.name} done`);
        refresh();
      }}
    />
  ) : null;

  return {
    tree,
    content,
    commands,
    status,
    busy: active && shell.containers.loading,
    refresh,
    dialogs,
    details,
    attention: sectionAttention,
    placeStatus: (p: string) => {
      const pr = byName.get(p.split("/")[0]);
      return pr ? statusOf(pr) : undefined;
    },
  };
}
