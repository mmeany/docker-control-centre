// Volumes: list, details with the containers using each, delete, prune.
// Deleting a volume destroys its data, so it's a typed confirmation.
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { resourcesApi, type VolumeItem } from "../../api/resources";
import { CommandButton, CommandSeparator } from "../../components/CommandButton";
import type { MenuItem } from "../../components/ContextMenu";
import { ErrorPanel } from "../../components/ErrorPanel";
import { FileList, type Column, type Row } from "../../components/FileList";
import { CopyIcon, DeleteIcon, FolderIcon, PruneIcon, RefreshIcon, VolumeIcon } from "../../components/Icons";
import { formatDate } from "../../format";
import type { SectionUi, Shell } from "../../shell/shell";
import { useEngineList } from "../../state/engineList";
import { LAST, NameList, PropsTable, runRemoval, UsedBy } from "../common";
import { ResourceTree } from "../ResourceTree";
import { flatPaths, NAME_KEY, orphanedVolumes, unusedVolumes, volumeUsers } from "../rules";
import { StatusMark } from "../../components/StatusMark";
import { volumeStatus } from "../../status/status";

const SECTION = "volumes";
export const volumesPaths = flatPaths((s) => NAME_KEY.test(s));

const COLUMNS: Column[] = [
  { id: "name", label: "Name", width: 300 },
  { id: "project", label: "Project", width: 120 },
  { id: "used", label: "Used by", width: 200 },
  { id: "driver", label: "Driver", width: 80 },
  { id: "created", label: "Created", width: 150 },
];

/** Long anonymous names are hashes: show the start. */
const label = (v: VolumeItem) => (v.anonymous && v.name.length > 20 ? `${v.name.slice(0, 12)}… (anonymous)` : v.name);

export function useVolumesSection(shell: Shell): SectionUi {
  const { place, engine, copyText } = shell;
  const active = place.section === SECTION;
  const path = active ? place.path : "";
  const go = useCallback((p: string) => shell.navigate({ section: SECTION, path: p }), [shell]);

  const volumes = useEngineList(engine, engine.changes.volume, resourcesApi.listVolumes);
  const containers = shell.containers.items ?? [];
  const [selection, setSelection] = useState({ path: "", keys: new Set<string>() });
  const selected = selection.path === path ? selection.keys : new Set<string>();
  const setSelected = (keys: Set<string>) => setSelection({ path, keys });

  const byName = useMemo(() => new Map((volumes.items ?? []).map((v) => [v.name, v])), [volumes.items]);
  const live = shell.liveProjects;
  const statusOf = (v: VolumeItem) => volumeStatus(v, containers, live);
  const current = path ? byName.get(path) : undefined;
  const targets: VolumeItem[] = selected.size ? [...selected].map((k) => byName.get(k)).filter((x): x is VolumeItem => !!x) : current ? [current] : [];

  /** Typed confirmation, then delete; in-use volumes are left out up front. */
  async function remove(list: VolumeItem[], title?: string) {
    const inUse = list.filter((v) => volumeUsers(containers, v.name).length > 0);
    const todo = list.filter((v) => !inUse.includes(v));
    if (todo.length === 0) {
      shell.showError({ kind: "invalid", message: `Containers use ${inUse.length === 1 ? "that volume" : "those volumes"}. Delete the containers first.`, detail: "" });
      return;
    }
    const confirm = todo.length === 1 ? todo[0].name : "delete";
    const ok = await shell.confirmTyped(
      title ?? (todo.length === 1 ? `Delete volume ${label(todo[0])}?` : `Delete ${todo.length} volumes?`),
      <>
        <p>The data in {todo.length === 1 ? "this volume" : "these volumes"} is deleted for good. There's no undo.</p>
        <NameList names={todo.map(label)} />
        {inUse.length > 0 && <p className="warn-note">Left out because containers use them: {inUse.map(label).join(", ")}.</p>}
      </>,
      confirm,
      "Delete",
    );
    if (!ok) return;
    await runRemoval(
      shell,
      { one: "volume", many: "volumes" },
      `Deleting ${todo.length.toLocaleString()} volumes…`,
      () => resourcesApi.removeVolumes(todo.map((v) => v.name)),
      (n) => n,
      () => {
        volumes.refresh();
        if (current && todo.includes(current)) go("");
      },
    );
  }

  async function prune() {
    const all = volumes.items ?? [];
    const anon = orphanedVolumes(all, containers, live);
    const unused = unusedVolumes(all, containers, live);
    if (unused.length === 0) {
      shell.showFlash("Nothing to prune: containers use every volume");
      return;
    }
    const scope = await shell.ask(
      "Prune volumes",
      <p>
        Pruning deletes volumes no container uses, including stopped ones. Orphaned volumes (marked orange) are anonymous ones nothing mounts, or ones left by a
        compose project that's gone. You'll see the list before anything goes.
      </p>,
      [
        ...(anon.length ? [{ label: `Orphaned only (${anon.length})`, value: "anon", primary: true }] : []),
        { label: `All unused (${unused.length})`, value: "all", primary: !anon.length },
        { label: "Cancel", value: "cancel" },
      ],
      "cancel",
    );
    if (scope === "cancel") return;
    await remove(scope === "anon" ? anon : unused, "Prune volumes");
  }

  const rows: Row[] = useMemo(
    () =>
      (volumes.items ?? []).map((v) => {
        const users = volumeUsers(containers, v.name);
        return {
          key: v.name,
          icon: <VolumeIcon />,
          isContainer: false,
          status: statusOf(v),
          cells: {
            name: { text: label(v), sort: `${v.anonymous ? LAST : ""}${v.name.toLowerCase()}` },
            project: { text: v.project ?? "", sort: v.project ?? "" },
            used: { text: users.map((c) => c.name).join(", "), sort: users.length },
            driver: { text: v.driver, sort: v.driver },
            created: { text: formatDate(v.created), sort: v.created },
          },
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [volumes.items, containers, live],
  );

  function openMenu(key: string | null, x: number, y: number) {
    const menu: MenuItem[] = [];
    if (key) {
      const keys = selected.has(key) ? [...selected] : [key];
      const list = keys.map((k) => byName.get(k)).filter((v): v is VolumeItem => !!v);
      if (keys.length === 1)
        menu.push({ label: "Open", bold: true, shortcut: "Enter", onClick: () => go(key) }, { label: "Open in new tab", onClick: () => shell.openInNewTab({ section: SECTION, path: key }) }, "separator");
      menu.push({ label: "Delete…", shortcut: "Del", onClick: () => void remove(list) }, "separator");
      if (list.length === 1) menu.push({ label: "Copy name", onClick: () => void copyText(list[0].name) }, "separator");
    } else menu.push({ label: "Prune…", onClick: () => void prune() }, "separator");
    menu.push({ label: "Refresh", shortcut: "F5", onClick: volumes.refresh });
    shell.openMenu(x, y, menu);
  }

  const commands = active ? (
    <>
      <CommandButton icon={<FolderIcon />} label="Open" title="Open the selected volume (Enter)" disabled={selected.size !== 1} onClick={() => go([...selected][0])} />
      <CommandSeparator />
      <CommandButton icon={<DeleteIcon />} label="Delete" title="Delete the selected volumes and their data (Del)" disabled={targets.length === 0} onClick={() => void remove(targets)} />
      <CommandButton icon={<PruneIcon />} label="Prune…" title="Delete volumes no container uses" onClick={() => void prune()} />
      <CommandButton icon={<CopyIcon />} label="Copy name" title="Copy the volume's name" disabled={targets.length !== 1} onClick={() => void copyText(targets[0].name)} />
      <CommandSeparator />
      <CommandButton icon={<RefreshIcon />} label="Refresh" title="Refresh (F5)" onClick={volumes.refresh} />
    </>
  ) : null;

  const tree = (
    <ResourceTree
      label="Volumes"
      icon={<VolumeIcon />}
      items={volumes.items && volumes.items.map((v) => ({ key: v.name, label: label(v), status: statusOf(v) }))}
      note={engine.status === "connected" ? "Loading…" : "Not connected"}
      emptyText="No volumes"
      selected={active ? path : null}
      level={shell.treeLevel}
      rootSelected={active && !path}
      onRoot={() => go("")}
      onOpen={go}
      onMenu={openMenu}
    />
  );

  let content: ReactNode = null;
  let status = "";
  if (active) {
    if (volumes.error) content = <ErrorPanel error={volumes.error} onRetry={volumes.refresh} />;
    else if (volumes.items === null) content = <div className="empty-note">{engine.status === "connected" ? "Loading…" : engine.message || "Not connected to the engine."}</div>;
    else if (!path) {
      content = (
        <FileList columns={COLUMNS} rows={rows} selected={selected} onSelectionChange={setSelected} onOpen={go} onContextMenu={openMenu} emptyText="No volumes." view={shell.view} />
      );
      const unused = unusedVolumes(volumes.items, containers, live).length;
      status = `${volumes.items.length.toLocaleString()} volumes · ${unused.toLocaleString()} unused`;
      if (selected.size > 1) status += ` · ${selected.size} selected`;
    } else if (!current) content = <ErrorPanel error={{ kind: "notFound", message: `There's no volume called ${path}.`, detail: "" }} />;
    else {
      content = (
        <div className="section-pane">
          <div className="detail-view" style={{ overflow: "auto" }}>
            <VolumeProps v={current} />
            <h3>Used by</h3>
            <UsedBy containers={volumeUsers(containers, current.name)} shell={shell} what="volume" />
            {current.labels.length > 0 && (
              <>
                <h3>Labels</h3>
                <PropsTable rows={current.labels.map((kv) => [kv.key, kv.value])} />
              </>
            )}
          </div>
        </div>
      );
      status = `${label(current)} · ${current.driver}`;
    }
  }

  const paneItem = selected.size === 1 ? byName.get([...selected][0]) : current;
  const details = paneItem ? (
    <>
      <div className="details-head">
        <span className="fl-icon">
          <VolumeIcon />
        </span>
        <div>
          <div className="details-title">{label(paneItem)}</div>
          <div className="details-sub">
            <StatusMark status={statusOf(paneItem)} /> {statusOf(paneItem).reason}
          </div>
          <div className="details-sub">{paneItem.anonymous ? "Anonymous volume" : "Volume"}</div>
        </div>
      </div>
      <VolumeProps v={paneItem} usedBy={volumeUsers(containers, paneItem.name).map((c) => c.name).join(", ") || "Nothing"} />
    </>
  ) : undefined;

  return {
    tree,
    content,
    commands,
    status,
    busy: active && volumes.loading,
    refresh: volumes.refresh,
    dialogs: null,
    details,
    onDelete: targets.length ? () => void remove(targets) : undefined,
    attention: { errors: 0, orphans: orphanedVolumes(volumes.items ?? [], containers, live).length },
    placeStatus: (p: string) => {
      const v = byName.get(p);
      return v ? statusOf(v) : undefined;
    },
  };
}

function VolumeProps({ v, usedBy }: { v: VolumeItem; usedBy?: string }) {
  return (
    <PropsTable
      rows={[
        ["Name", <span className="mono">{v.name}</span>],
        ["Used by", usedBy],
        ["Project", v.project],
        ["Driver", v.driver],
        ["Scope", v.scope],
        ["Created", formatDate(v.created)],
        ["Mount point", <span className="mono">{v.mountpoint}</span>],
        ["Options", v.options.map((o) => `${o.key}=${o.value}`).join(", ")],
      ]}
    />
  );
}
