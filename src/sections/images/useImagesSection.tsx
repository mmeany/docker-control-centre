// Images: list, inspect (config, history, who uses it), pull, delete, prune.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppError } from "../../api/core";
import { resourcesApi, type ImageDetails, type ImageItem } from "../../api/resources";
import { Board } from "../../components/Board";
import { CommandButton, CommandSeparator } from "../../components/CommandButton";
import type { MenuItem } from "../../components/ContextMenu";
import { ErrorPanel } from "../../components/ErrorPanel";
import { FileList, type Column, type Row } from "../../components/FileList";
import { CopyIcon, DeleteIcon, DownloadIcon, FolderIcon, ImageIcon, PruneIcon, RefreshIcon } from "../../components/Icons";
import { formatDate, formatSize } from "../../format";
import type { SectionUi, Shell } from "../../shell/shell";
import { useEngineList } from "../../state/engineList";
import { LAST, NameList, PropsTable, runRemoval, UsedBy } from "../common";
import { ResizableTable } from "../../components/ResizableTable";
import { ResourceTree } from "../ResourceTree";
import { flatPaths, IMAGE_KEY, imageName, imageRefs, imageUsers, orphanedImages, shortId, totalSize, unusedImages } from "../rules";
import { StatusMark } from "../../components/StatusMark";
import { imageStatus } from "../../status/status";
import { PullDialog } from "./PullDialog";

const SECTION = "images";
export const imagesPaths = flatPaths((s) => IMAGE_KEY.test(s));

const COLUMNS: Column[] = [
  { id: "name", label: "Name", width: 280 },
  { id: "id", label: "Image ID", width: 110 },
  { id: "created", label: "Created", width: 150 },
  { id: "size", label: "Size", width: 90, align: "right" },
  { id: "used", label: "Used by", width: 120 },
  { id: "tags", label: "Other tags", width: 260 },
];

const REFERENCE = /^[a-zA-Z0-9][a-zA-Z0-9._\-/:@]*$/;

export function useImagesSection(shell: Shell): SectionUi {
  const { place, engine, copyText } = shell;
  const active = place.section === SECTION;
  const path = active ? place.path : "";
  const go = useCallback((p: string) => shell.navigate({ section: SECTION, path: p }), [shell]);

  const images = useEngineList(engine, engine.changes.image, resourcesApi.listImages);
  const containers = shell.containers.items ?? [];
  const [selection, setSelection] = useState({ path: "", keys: new Set<string>() });
  const selected = selection.path === path ? selection.keys : new Set<string>();
  const setSelected = (keys: Set<string>) => setSelection({ path, keys });
  const [pulling, setPulling] = useState<string | null>(null);
  const [details, setDetails] = useState<{ id: string; data: ImageDetails | null; error: AppError | null } | null>(null);

  const byKey = useMemo(() => new Map((images.items ?? []).map((i) => [shortId(i.id), i])), [images.items]);
  const current = path ? byKey.get(path) : undefined;
  const single = selected.size === 1 ? byKey.get([...selected][0]) : undefined;
  const inspectTarget = current ?? single;

  useEffect(() => {
    if (!inspectTarget || engine.status !== "connected") return;
    let stale = false;
    const id = inspectTarget.id;
    resourcesApi
      .inspectImage(id)
      .then((data) => !stale && setDetails({ id, data, error: null }))
      .catch((e) => !stale && setDetails({ id, data: null, error: e as AppError }));
    return () => {
      stale = true;
    };
  }, [inspectTarget?.id, engine.status, engine.changes.image]);

  const targets: ImageItem[] = selected.size ? [...selected].map((k) => byKey.get(k)).filter((x): x is ImageItem => !!x) : current ? [current] : [];

  // ---------------------------------------------------------------------------
  // Actions

  async function pull() {
    const reference = await shell.askName("Pull an image", "Image (name and optional tag, e.g. nginx:1.27)", "", "Pull", (v) =>
      !v.trim() ? "Enter an image name." : REFERENCE.test(v.trim()) ? null : "That isn't an image name.",
    );
    if (reference) setPulling(reference.trim());
  }

  async function remove(list: ImageItem[]) {
    if (list.length === 0) return;
    const inUse = list.filter((i) => imageUsers(containers, i.id).length > 0);
    const running = inUse.filter((i) => imageUsers(containers, i.id).some((c) => c.state === "running" || c.state === "paused"));
    const opts = { force: false };
    const choice = await shell.ask(
      list.length === 1 ? `Delete ${imageName(list[0])}?` : `Delete ${list.length} images?`,
      <>
        <p>Deleting removes every tag shown, and the image itself once nothing else refers to it.</p>
        <NameList names={list.map((i) => `${imageName(i)} (${formatSize(i.size)})`)} />
        {running.length > 0 && <p className="warn-note">Running containers use {running.length === 1 ? "one of these" : `${running.length} of these`}. Docker won't delete an image a running container uses.</p>}
        {inUse.length > running.length && (
          <label className="check-row">
            <input type="checkbox" onChange={(e) => (opts.force = e.target.checked)} /> Also delete images that stopped containers use
          </label>
        )}
      </>,
      [
        { label: "Delete", value: "delete", danger: true },
        { label: "Cancel", value: "cancel", primary: true },
      ],
      "cancel",
    );
    if (choice !== "delete") return;
    const refs = list.flatMap(imageRefs);
    await runRemoval(
      shell,
      { one: "image reference", many: "image references" },
      `Deleting ${refs.length.toLocaleString()} image references…`,
      () => resourcesApi.removeImages(refs, opts.force),
      (r) => r,
      () => {
        images.refresh();
        if (current && list.includes(current)) go("");
      },
    );
  }

  async function prune() {
    const all = images.items ?? [];
    const dangling = orphanedImages(all, containers);
    const unused = unusedImages(all, containers);
    if (unused.length === 0) {
      shell.showFlash("Nothing to prune: every image is used by a container");
      return;
    }
    const scope = await shell.ask(
      "Prune images",
      <>
        <p>
          Pruning deletes images no container uses, including stopped ones. Orphaned images (untagged, marked orange) are the safe choice. You'll see the list
          before anything goes.
        </p>
      </>,
      [
        ...(dangling.length ? [{ label: `Orphaned only (${dangling.length}, ${formatSize(totalSize(dangling))})`, value: "dangling", primary: true }] : []),
        { label: `All unused (${unused.length}, ${formatSize(totalSize(unused))})`, value: "unused", primary: !dangling.length },
        { label: "Cancel", value: "cancel" },
      ],
      "cancel",
    );
    if (scope === "cancel") return;
    const list = scope === "dangling" ? dangling : unused;
    const ok = await shell.ask(
      `Delete ${list.length} images?`,
      <>
        <p>These will be deleted, freeing about {formatSize(totalSize(list))}:</p>
        <NameList names={list.map((i) => `${imageName(i)} (${formatSize(i.size)})`)} />
      </>,
      [
        { label: "Delete", value: "delete", danger: true },
        { label: "Cancel", value: "cancel", primary: true },
      ],
      "cancel",
    );
    if (ok !== "delete") return;
    const refs = list.flatMap(imageRefs);
    await runRemoval(
      shell,
      { one: "image reference", many: "image references" },
      `Deleting ${list.length.toLocaleString()} images…`,
      () => resourcesApi.removeImages(refs, false),
      (r) => r,
      images.refresh,
    );
  }

  // ---------------------------------------------------------------------------
  // Rows, menus, commands

  const rows: Row[] = useMemo(
    () =>
      (images.items ?? []).map((i) => {
        const users = imageUsers(containers, i.id);
        const running = users.filter((c) => c.state === "running").length;
        return {
          key: shortId(i.id),
          icon: <ImageIcon />,
          isContainer: false,
          status: imageStatus(i, containers),
          cells: {
            name: { text: imageName(i), sort: i.tags.length ? imageName(i).toLowerCase() : `${LAST}${i.id}` },
            id: { text: shortId(i.id), sort: i.id },
            created: { text: formatDate(i.created), sort: i.created },
            size: { text: formatSize(i.size), sort: i.size },
            used: { text: users.length ? `${users.length} container${users.length === 1 ? "" : "s"}${running ? `, ${running} running` : ""}` : "", sort: users.length },
            tags: { text: i.tags.slice(1).join(", "), sort: i.tags.length },
          },
        };
      }),
    [images.items, containers],
  );

  function openMenu(key: string | null, x: number, y: number) {
    const menu: MenuItem[] = [];
    if (key) {
      const keys = selected.has(key) ? [...selected] : [key];
      const list = keys.map((k) => byKey.get(k)).filter((i): i is ImageItem => !!i);
      if (keys.length === 1) menu.push({ label: "Open", bold: true, shortcut: "Enter", onClick: () => go(key) }, { label: "Open in new tab", onClick: () => shell.openInNewTab({ section: SECTION, path: key }) }, "separator");
      menu.push({ label: "Delete…", shortcut: "Del", onClick: () => void remove(list) }, "separator");
      if (list.length === 1) {
        menu.push({ label: "Copy ID", onClick: () => void copyText(list[0].id) });
        if (list[0].tags.length) menu.push({ label: "Copy name", onClick: () => void copyText(list[0].tags[0]) });
        menu.push("separator");
      }
    } else {
      menu.push({ label: "Pull an image…", onClick: () => void pull() }, { label: "Prune…", onClick: () => void prune() }, "separator");
    }
    menu.push({ label: "Refresh", shortcut: "F5", onClick: images.refresh });
    shell.openMenu(x, y, menu);
  }

  const commands = active ? (
    <>
      <CommandButton icon={<FolderIcon />} label="Open" title="Open the selected image (Enter)" disabled={selected.size !== 1} onClick={() => go([...selected][0])} />
      <CommandSeparator />
      <CommandButton icon={<DownloadIcon />} label="Pull…" title="Pull an image from a registry" onClick={() => void pull()} />
      <CommandButton icon={<DeleteIcon />} label="Delete" title="Delete the selected images (Del)" disabled={targets.length === 0} onClick={() => void remove(targets)} />
      <CommandButton icon={<PruneIcon />} label="Prune…" title="Delete images no container uses" onClick={() => void prune()} />
      <CommandButton icon={<CopyIcon />} label="Copy ID" title="Copy the image's full ID" disabled={targets.length !== 1} onClick={() => void copyText(targets[0].id)} />
      <CommandSeparator />
      <CommandButton icon={<RefreshIcon />} label="Refresh" title="Refresh (F5)" onClick={images.refresh} />
    </>
  ) : null;

  // ---------------------------------------------------------------------------
  // Tree, content, details

  const tree = (
    <ResourceTree
      label="Images"
      icon={<ImageIcon />}
      items={images.items && images.items.map((i) => ({ key: shortId(i.id), label: imageName(i), status: imageStatus(i, containers) }))}
      note={engine.status === "connected" ? "Loading…" : "Not connected"}
      emptyText="No images"
      selected={active ? path : null}
      level={shell.treeLevel}
      rootSelected={active && !path}
      onRoot={() => go("")}
      onOpen={go}
      onMenu={openMenu}
    />
  );

  const loaded = details?.data && inspectTarget && details.id === inspectTarget.id ? details.data : null;
  let content: ReactNode = null;
  let board: ReactNode = undefined;
  let status = "";
  if (active) {
    if (images.error) content = <ErrorPanel error={images.error} onRetry={images.refresh} />;
    else if (images.items === null) content = <div className="empty-note">{engine.status === "connected" ? "Loading…" : engine.message || "Not connected to the engine."}</div>;
    else if (!path) {
      content = (
        <FileList
          columnsKey="images"
          columns={COLUMNS}
          rows={rows}
          selected={selected}
          onSelectionChange={setSelected}
          onOpen={go}
          onContextMenu={openMenu}
          emptyText="No images. Use Pull… to download one."
          view={shell.view}
        />
      );
      board = (
        <Board
          columns={COLUMNS}
          rows={rows}
          selected={selected}
          onSelectionChange={setSelected}
          onOpen={go}
          onMenu={openMenu}
          actions={(k) => [{ label: "Delete…", icon: <DeleteIcon />, danger: true, onClick: () => { const i = byKey.get(k); if (i) void remove([i]); } }]}
          bulk={[{ label: "Delete…", danger: true, disabled: targets.length === 0, onClick: () => void remove(targets) }]}
          emptyText="No images. Use Pull… to download one."
        />
      );
      const n = images.items.length;
      status = `${n.toLocaleString()} image${n === 1 ? "" : "s"} · ${formatSize(totalSize(images.items))}`;
      if (selected.size > 1) status += ` · ${selected.size} selected`;
    } else if (!current) {
      content = <ErrorPanel error={{ kind: "notFound", message: `There's no image ${path}. It may have been deleted.`, detail: "" }} />;
    } else {
      content =
        details?.error && details.id === current.id ? (
          <ErrorPanel error={details.error} onRetry={images.refresh} />
        ) : (
          <ImageView image={current} details={loaded} shell={shell} />
        );
      status = `${imageName(current)} · ${formatSize(current.size)}`;
    }
  }

  const pane = inspectTarget ? (
    <>
      <div className="details-head">
        <span className="fl-icon">
          <ImageIcon />
        </span>
        <div>
          <div className="details-title">{imageName(inspectTarget)}</div>
          <div className="details-sub">
            <StatusMark status={imageStatus(inspectTarget, containers)} /> {imageStatus(inspectTarget, containers).reason}
          </div>
          <div className="details-sub">{formatSize(inspectTarget.size)}</div>
        </div>
      </div>
      <PropsTable
        rows={[
          ["Tags", inspectTarget.tags.join(", ")],
          ["Created", formatDate(inspectTarget.created)],
          ["Platform", loaded?.platform],
          ["Command", loaded && [loaded.entrypoint, loaded.command].filter(Boolean).join(" ")],
          ["Used by", imageUsers(containers, inspectTarget.id).map((c) => c.name).join(", ")],
          ["ID", <span className="mono">{shortId(inspectTarget.id)}</span>],
        ]}
      />
    </>
  ) : undefined;

  const dialogs = pulling ? (
    <PullDialog
      reference={pulling}
      onDone={(error) => {
        const ref = pulling;
        setPulling(null);
        if (error === null) shell.showFlash(`Pulled ${ref}`);
        else if (error) shell.showError({ kind: "other", message: `Couldn't pull ${ref}: ${error}`, detail: "" });
        images.refresh();
      }}
    />
  ) : null;

  return {
    tree,
    content,
    board,
    commands,
    status,
    busy: active && images.loading,
    refresh: images.refresh,
    dialogs,
    details: pane,
    onDelete: targets.length ? () => void remove(targets) : undefined,
    attention: { errors: 0, orphans: orphanedImages(images.items ?? [], containers).length },
    placeStatus: (p: string) => {
      const i = byKey.get(p);
      return i ? imageStatus(i, containers) : undefined;
    },
  };
}

function ImageView({ image, details: d, shell }: { image: ImageItem; details: ImageDetails | null; shell: Shell }) {
  const users = imageUsers(shell.containers.items ?? [], image.id);
  return (
    <div className="section-pane">
      <div className="detail-view" style={{ overflow: "auto" }}>
        <PropsTable
          rows={[
            ["Tags", image.tags.join(", ") || "None (untagged)"],
            ["Image ID", <span className="mono">{image.id}</span>],
            ["Digests", image.digests.length ? <span className="mono">{image.digests.join(", ")}</span> : ""],
            ["Created", formatDate(image.created)],
            ["Size", formatSize(image.size)],
            ["Platform", d?.platform],
            ["Entrypoint", d?.entrypoint && <span className="mono">{d.entrypoint}</span>],
            ["Command", d?.command && <span className="mono">{d.command}</span>],
            ["Working dir", d?.workingDir],
            ["User", d?.user],
            ["Ports", d?.exposedPorts.join(", ")],
            ["Layers", d ? d.layers.toLocaleString() : ""],
            ["Author", d?.author],
          ]}
        />
        <h3>Used by</h3>
        <UsedBy containers={users} shell={shell} what="image" />
        {d && d.env.length > 0 && (
          <>
            <h3>Environment</h3>
            <PropsTable rows={d.env.map((kv) => [kv.key, <span className="mono">{kv.value}</span>])} />
          </>
        )}
        {d && d.labels.length > 0 && (
          <>
            <h3>Labels</h3>
            <PropsTable rows={d.labels.map((kv) => [kv.key, kv.value])} />
          </>
        )}
        {d && (
          <>
            <h3>History</h3>
            <div className="data-table-wrap">
              <ResizableTable
                tableKey="imageHistory"
                columns={[
                  { id: "created", label: "Created" },
                  { id: "step", label: "Step" },
                  { id: "size", label: "Size", className: "right" },
                ]}
              >
                <tbody>
                  {d.history.map((h, i) => (
                    <tr key={i}>
                      <td>{formatDate(h.created)}</td>
                      <td className="mono">{h.createdBy}</td>
                      <td className="right">{h.size ? formatSize(h.size) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </ResizableTable>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
