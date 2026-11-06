// Networks: list, details with attached containers, delete, prune. Docker's
// own networks (bridge, host, none) can't be deleted.
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { resourcesApi, type NetworkItem } from "../../api/resources";
import { CommandButton, CommandSeparator } from "../../components/CommandButton";
import type { MenuItem } from "../../components/ContextMenu";
import { ErrorPanel } from "../../components/ErrorPanel";
import { FileList, type Column, type Row } from "../../components/FileList";
import { CopyIcon, DeleteIcon, FolderIcon, NetworkIcon, PruneIcon, RefreshIcon } from "../../components/Icons";
import { formatDate } from "../../format";
import type { SectionUi, Shell } from "../../shell/shell";
import { useEngineList } from "../../state/engineList";
import { LAST, NameList, PropsTable, runRemoval, UsedBy } from "../common";
import { ResourceTree } from "../ResourceTree";
import { flatPaths, NAME_KEY, networkUsers, orphanedNetworks, unusedNetworks } from "../rules";
import { StatusMark } from "../../components/StatusMark";
import { networkStatus } from "../../status/status";

const SECTION = "networks";
export const networksPaths = flatPaths((s) => NAME_KEY.test(s));

const COLUMNS: Column[] = [
  { id: "name", label: "Name", width: 220 },
  { id: "driver", label: "Driver", width: 80 },
  { id: "subnet", label: "Subnet", width: 150 },
  { id: "used", label: "Containers", width: 220 },
  { id: "project", label: "Project", width: 110 },
  { id: "created", label: "Created", width: 150 },
];

export function useNetworksSection(shell: Shell): SectionUi {
  const { place, engine, copyText } = shell;
  const active = place.section === SECTION;
  const path = active ? place.path : "";
  const go = useCallback((p: string) => shell.navigate({ section: SECTION, path: p }), [shell]);

  const networks = useEngineList(engine, engine.changes.network, resourcesApi.listNetworks);
  const containers = shell.containers.items ?? [];
  const [selection, setSelection] = useState({ path: "", keys: new Set<string>() });
  const selected = selection.path === path ? selection.keys : new Set<string>();
  const setSelected = (keys: Set<string>) => setSelection({ path, keys });

  const byName = useMemo(() => new Map((networks.items ?? []).map((n) => [n.name, n])), [networks.items]);
  const live = shell.liveProjects;
  const statusOf = (n: NetworkItem) => networkStatus(n, containers, live);
  const current = path ? byName.get(path) : undefined;
  const targets: NetworkItem[] = selected.size ? [...selected].map((k) => byName.get(k)).filter((x): x is NetworkItem => !!x) : current ? [current] : [];
  const deletable = targets.filter((n) => !n.builtin);

  async function remove(list: NetworkItem[], title?: string) {
    const todo = list.filter((n) => !n.builtin);
    if (todo.length === 0) return;
    const inUse = todo.filter((n) => networkUsers(containers, n.name).length > 0);
    const choice = await shell.ask(
      title ?? (todo.length === 1 ? `Delete network ${todo[0].name}?` : `Delete ${todo.length} networks?`),
      <>
        <NameList names={todo.map((n) => n.name)} />
        {inUse.length > 0 && <p className="warn-note">Containers are attached to {inUse.map((n) => n.name).join(", ")}. Docker won't delete a network while containers use it.</p>}
        {list.length > todo.length && <p className="hint">Docker's own networks (bridge, host, none) are left alone.</p>}
      </>,
      [
        { label: "Delete", value: "delete", danger: true },
        { label: "Cancel", value: "cancel", primary: true },
      ],
      "cancel",
    );
    if (choice !== "delete") return;
    const names = new Map(todo.map((n) => [n.id, n.name]));
    await runRemoval(
      shell,
      { one: "network", many: "networks" },
      `Deleting ${todo.length.toLocaleString()} networks…`,
      () => resourcesApi.removeNetworks(todo.map((n) => n.id)),
      (id) => names.get(id) ?? id,
      () => {
        networks.refresh();
        if (current && todo.includes(current)) go("");
      },
    );
  }

  async function prune() {
    const all = networks.items ?? [];
    const orphans = orphanedNetworks(all, containers, live);
    const unused = unusedNetworks(all, containers, live);
    if (unused.length === 0) {
      shell.showFlash("Nothing to prune: every network has containers or is Docker's own");
      return;
    }
    const scope = await shell.ask(
      "Prune networks",
      <p>
        Pruning deletes networks no container is attached to; Docker's own networks are left alone. Orphaned networks (marked orange) were left by a compose
        project that's gone. You'll see the list before anything goes.
      </p>,
      [
        ...(orphans.length ? [{ label: `Orphaned only (${orphans.length})`, value: "orphans", primary: true }] : []),
        { label: `All unused (${unused.length})`, value: "all", primary: !orphans.length },
        { label: "Cancel", value: "cancel" },
      ],
      "cancel",
    );
    if (scope === "cancel") return;
    await remove(scope === "orphans" ? orphans : unused, "Prune networks: delete these networks?");
  }

  const rows: Row[] = useMemo(
    () =>
      (networks.items ?? []).map((n) => {
        const users = networkUsers(containers, n.name);
        return {
          key: n.name,
          icon: <NetworkIcon />,
          isContainer: false,
          status: statusOf(n),
          cells: {
            name: { text: n.builtin ? `${n.name} (Docker's own)` : n.name, sort: `${n.builtin ? LAST : ""}${n.name}` },
            driver: { text: n.driver, sort: n.driver },
            subnet: { text: n.subnets.join(", "), sort: n.subnets.join(",") },
            used: { text: users.map((c) => c.name).join(", "), sort: users.length },
            project: { text: n.project ?? "", sort: n.project ?? "" },
            created: { text: formatDate(n.created), sort: n.created },
          },
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [networks.items, containers, live],
  );

  function openMenu(key: string | null, x: number, y: number) {
    const menu: MenuItem[] = [];
    if (key) {
      const keys = selected.has(key) ? [...selected] : [key];
      const list = keys.map((k) => byName.get(k)).filter((n): n is NetworkItem => !!n);
      if (keys.length === 1)
        menu.push({ label: "Open", bold: true, shortcut: "Enter", onClick: () => go(key) }, { label: "Open in new tab", onClick: () => shell.openInNewTab({ section: SECTION, path: key }) }, "separator");
      if (list.some((n) => !n.builtin)) menu.push({ label: "Delete…", shortcut: "Del", onClick: () => void remove(list) }, "separator");
      if (list.length === 1) menu.push({ label: "Copy ID", onClick: () => void copyText(list[0].id) }, "separator");
    } else menu.push({ label: "Prune…", onClick: () => void prune() }, "separator");
    menu.push({ label: "Refresh", shortcut: "F5", onClick: networks.refresh });
    shell.openMenu(x, y, menu);
  }

  const commands = active ? (
    <>
      <CommandButton icon={<FolderIcon />} label="Open" title="Open the selected network (Enter)" disabled={selected.size !== 1} onClick={() => go([...selected][0])} />
      <CommandSeparator />
      <CommandButton icon={<DeleteIcon />} label="Delete" title="Delete the selected networks (Del)" disabled={deletable.length === 0} onClick={() => void remove(targets)} />
      <CommandButton icon={<PruneIcon />} label="Prune…" title="Delete networks no container uses" onClick={() => void prune()} />
      <CommandButton icon={<CopyIcon />} label="Copy ID" title="Copy the network's ID" disabled={targets.length !== 1} onClick={() => void copyText(targets[0].id)} />
      <CommandSeparator />
      <CommandButton icon={<RefreshIcon />} label="Refresh" title="Refresh (F5)" onClick={networks.refresh} />
    </>
  ) : null;

  const tree = (
    <ResourceTree
      label="Networks"
      icon={<NetworkIcon />}
      items={networks.items && networks.items.map((n) => ({ key: n.name, label: n.name, status: statusOf(n) }))}
      note={engine.status === "connected" ? "Loading…" : "Not connected"}
      emptyText="No networks"
      selected={active ? path : null}
      rootSelected={active && !path}
      onRoot={() => go("")}
      onOpen={go}
      onMenu={openMenu}
    />
  );

  let content: ReactNode = null;
  let status = "";
  if (active) {
    if (networks.error) content = <ErrorPanel error={networks.error} onRetry={networks.refresh} />;
    else if (networks.items === null) content = <div className="empty-note">{engine.status === "connected" ? "Loading…" : engine.message || "Not connected to the engine."}</div>;
    else if (!path) {
      content = (
        <FileList columns={COLUMNS} rows={rows} selected={selected} onSelectionChange={setSelected} onOpen={go} onContextMenu={openMenu} emptyText="No networks." view={shell.view} />
      );
      status = `${networks.items.length.toLocaleString()} networks`;
      if (selected.size > 1) status += ` · ${selected.size} selected`;
    } else if (!current) content = <ErrorPanel error={{ kind: "notFound", message: `There's no network called ${path}.`, detail: "" }} />;
    else {
      content = (
        <div className="section-pane">
          <div className="detail-view" style={{ overflow: "auto" }}>
            <NetworkProps n={current} />
            <h3>Containers</h3>
            <UsedBy containers={networkUsers(containers, current.name)} shell={shell} what="network" />
            {current.labels.length > 0 && (
              <>
                <h3>Labels</h3>
                <PropsTable rows={current.labels.map((kv) => [kv.key, kv.value])} />
              </>
            )}
          </div>
        </div>
      );
      status = `${current.name} · ${current.driver}`;
    }
  }

  const paneItem = selected.size === 1 ? byName.get([...selected][0]) : current;
  const details = paneItem ? (
    <>
      <div className="details-head">
        <span className="fl-icon">
          <NetworkIcon />
        </span>
        <div>
          <div className="details-title">{paneItem.name}</div>
          <div className="details-sub">
            <StatusMark status={statusOf(paneItem)} /> {statusOf(paneItem).reason}
          </div>
          <div className="details-sub">{paneItem.builtin ? "Docker's own network" : `${paneItem.driver} network`}</div>
        </div>
      </div>
      <NetworkProps n={paneItem} containers={networkUsers(containers, paneItem.name).map((c) => c.name).join(", ") || "None"} />
    </>
  ) : undefined;

  return {
    tree,
    content,
    commands,
    status,
    busy: active && networks.loading,
    refresh: networks.refresh,
    dialogs: null,
    details,
    onDelete: deletable.length ? () => void remove(targets) : undefined,
    attention: { errors: 0, orphans: orphanedNetworks(networks.items ?? [], containers, live).length },
    placeStatus: (p: string) => {
      const n = byName.get(p);
      return n ? statusOf(n) : undefined;
    },
  };
}

function NetworkProps({ n, containers }: { n: NetworkItem; containers?: string }) {
  const flags = [n.internal && "internal (no outside access)", n.attachable && "attachable", n.ipv6 && "IPv6"].filter(Boolean).join(", ");
  return (
    <PropsTable
      rows={[
        ["Name", n.name],
        ["Containers", containers],
        ["Driver", n.driver],
        ["Scope", n.scope],
        ["Subnet", n.subnets.join(", ")],
        ["Gateway", n.gateways.join(", ")],
        ["Options", flags],
        ["Project", n.project],
        ["Created", formatDate(n.created)],
        ["ID", <span className="mono">{n.id.slice(0, 12)}</span>],
      ]}
    />
  );
}
