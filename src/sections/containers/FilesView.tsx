// A folder inside a container: browse, copy out, copy in (buttons, or drag
// files from Windows Explorer onto the list).
import { useEffect, useMemo, useState } from "react";
import { appApi } from "../../api/app";
import type { AppError } from "../../api/core";
import type { ContainerItem } from "../../api/engine";
import { filesApi, type FileEntry, type Listing } from "../../api/files";
import { ErrorPanel } from "../../components/ErrorPanel";
import { FileList, type Column, type Row } from "../../components/FileList";
import { FileIcon, FolderIcon } from "../../components/Icons";
import { formatDate, formatSize } from "../../format";
import type { Shell } from "../../shell/shell";
import { NameList } from "../common";

const COLUMNS: Column[] = [
  { id: "name", label: "Name", width: 280 },
  { id: "modified", label: "Date modified", width: 160 },
  { id: "type", label: "Type", width: 120 },
  { id: "size", label: "Size", width: 90, align: "right" },
  { id: "mode", label: "Permissions", width: 110 },
];

const TYPE: Record<FileEntry["kind"], string> = { file: "File", dir: "Folder", link: "Link", linkDir: "Link to folder", other: "Special" };
const isFolder = (e: FileEntry) => e.kind === "dir" || e.kind === "linkDir";
const join = (dir: string, name: string) => `${dir === "/" ? "" : dir}/${name}`;

interface Props {
  container: ContainerItem;
  /** Absolute folder in the container. */
  dir: string;
  shell: Shell;
  /** Opens a sub-folder (absolute path). */
  openDir: (path: string) => void;
}

export function FilesView({ container, dir, shell, openDir }: Props) {
  const [listing, setListing] = useState<{ dir: string; data: Listing | null; error: AppError | null } | null>(null);
  const [token, setToken] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dropping, setDropping] = useState(false);
  const running = container.state === "running";
  const reload = () => setToken((t) => t + 1);

  useEffect(() => {
    let stale = false;
    setSelected(new Set());
    filesApi
      .list(container.id, dir, running)
      .then((data) => !stale && setListing({ dir, data, error: null }))
      .catch((e) => !stale && setListing({ dir, data: null, error: e as AppError }));
    return () => {
      stale = true;
    };
  }, [container.id, dir, running, token]);

  async function copyIn(sources: string[]) {
    if (sources.length === 0) return;
    const ok = await shell.ask(
      `Copy into ${dir}?`,
      <>
        <p>
          These go into <span className="mono">{dir}</span> in {container.name}. Files with the same name are replaced.
        </p>
        <NameList names={sources} />
      </>,
      [
        { label: "Copy", value: "copy", primary: true },
        { label: "Cancel", value: "cancel" },
      ],
      "cancel",
    );
    if (ok !== "copy") return;
    shell.setWorking("Copying in…");
    try {
      const n = await filesApi.copyIn(container.id, dir, sources);
      shell.showFlash(`Copied ${n.toLocaleString()} file${n === 1 ? "" : "s"} into ${dir}`);
      reload();
    } catch (e) {
      shell.showError(e);
    } finally {
      shell.setWorking(null);
    }
  }

  // Files dragged in from Explorer: claimed from the shell while this shows,
  // so they're copied in rather than started as compose projects.
  useEffect(
    () =>
      shell.claimDrops({
        over: () => setDropping(true),
        leave: () => setDropping(false),
        drop: (paths) => {
          setDropping(false);
          void copyIn(paths);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [container.id, dir],
  );

  const current = listing && listing.dir === dir ? listing : null;
  const entries = useMemo(() => current?.data?.entries ?? [], [current]);
  const byName = useMemo(() => new Map(entries.map((e) => [e.name, e])), [entries]);
  const single = selected.size === 1 ? byName.get([...selected][0]) : undefined;

  async function copyOut(e: FileEntry) {
    try {
      const folder = isFolder(e);
      const dest = await appApi.pickSaveFile(folder ? `Save ${e.name} as an archive` : `Save ${e.name}`, folder ? `${e.name}.tar` : e.name);
      if (!dest) return;
      shell.setWorking("Copying out…");
      const r = await filesApi.copyOut(container.id, join(dir, e.name), dest);
      shell.showFlash(`Saved ${r.savedAs === "tar" ? "an archive of " : ""}${e.name} to ${dest} (${formatSize(r.bytes)})`);
    } catch (err) {
      shell.showError(err);
    } finally {
      shell.setWorking(null);
    }
  }

  async function pickAndCopyIn(folder: boolean) {
    try {
      const p = folder ? await appApi.pickFolder("Copy a folder in") : await appApi.pickOpenFile("Copy a file in", "All files", ["*"]);
      if (p) await copyIn([p]);
    } catch (e) {
      shell.showError(e);
    }
  }

  function open(name: string) {
    const e = byName.get(name);
    if (!e) return;
    if (isFolder(e)) openDir(join(dir, e.name));
    else void copyOut(e);
  }

  function menu(key: string | null, x: number, y: number) {
    const e = key ? byName.get(key) : undefined;
    shell.openMenu(x, y, [
      ...(e
        ? [
            isFolder(e) ? { label: "Open", bold: true, shortcut: "Enter", onClick: () => open(e.name) } : { label: "Copy out…", bold: true, shortcut: "Enter", onClick: () => void copyOut(e) },
            ...(isFolder(e) ? [{ label: "Copy out as archive…", onClick: () => void copyOut(e) }] : []),
            "separator" as const,
            { label: "Copy path", onClick: () => void shell.copyText(join(dir, e.name)) },
            "separator" as const,
          ]
        : []),
      { label: "Copy a file in…", onClick: () => void pickAndCopyIn(false) },
      { label: "Copy a folder in…", onClick: () => void pickAndCopyIn(true) },
      "separator",
      { label: "Refresh", shortcut: "F5", onClick: reload },
    ]);
  }

  const rows: Row[] = entries.map((e) => ({
    key: e.name,
    icon: isFolder(e) ? <FolderIcon /> : <FileIcon />,
    isContainer: isFolder(e),
    dimmed: e.name.startsWith("."),
    cells: {
      name: { text: e.name, sort: e.name.toLowerCase() },
      modified: { text: formatDate(e.modified), sort: e.modified },
      type: { text: TYPE[e.kind], sort: TYPE[e.kind] },
      size: { text: isFolder(e) ? "" : formatSize(e.size), sort: isFolder(e) ? -1 : e.size },
      mode: { text: e.mode, sort: e.mode },
    },
  }));

  const how =
    current?.data?.method === "archive"
      ? running
        ? "This image has no shell, so the folder was read from Docker's archive API."
        : `${container.name} isn't running, so the folder was read from Docker's archive API.`
      : "";

  return (
    <div className={`section-pane files-view ${dropping ? "drop-target" : ""}`}>
      <div className="filter-bar">
        <button className="btn" disabled={!single} onClick={() => single && void copyOut(single)} title="Save the selected file (a folder as .tar) on this computer">
          Copy out…
        </button>
        <button className="btn" onClick={() => void pickAndCopyIn(false)} title="Copy a file from this computer into this folder">
          Copy file in…
        </button>
        <button className="btn" onClick={() => void pickAndCopyIn(true)} title="Copy a folder from this computer into this folder">
          Copy folder in…
        </button>
        <span className="hint">or drag files here from Explorer</span>
        <div className="spacer" />
        {current?.data && <span className="field-label">{`${entries.length.toLocaleString()} item${entries.length === 1 ? "" : "s"}`}</span>}
      </div>
      {how && <div className="ok-note files-note">{how}</div>}
      {current?.data?.truncated && <div className="warn-note files-note">This folder is too large to read fully without a shell; some items may be missing.</div>}
      {current?.error ? (
        <ErrorPanel error={current.error} onRetry={reload} />
      ) : (
        <FileList
          key={dir}
          columnsKey="files"
          columns={COLUMNS}
          rows={rows}
          selected={selected}
          onSelectionChange={setSelected}
          onOpen={open}
          onContextMenu={menu}
          emptyText={current ? "This folder is empty." : "Loading…"}
          view={shell.view}
        />
      )}
    </div>
  );
}
