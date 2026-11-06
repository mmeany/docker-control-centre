// Sample section: browse folders on this computer and preview text files.
// It exists to show the patterns a real section uses; replace or delete it
// (and its entry in src/sections/index.ts, src-tauri/src/files.rs and
// src-tauri/src/commands/files.rs) when you build your own.
//
// Patterns shown: a tree branch with lazily loaded children; a details list
// (FileList) with sorting, selection and a context menu; a filter box with
// remembered history; command-bar buttons; a dialog; small values kept in
// settings (recent folders); one Rust command per operation.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { appApi } from "../../api/app";
import type { AppError } from "../../api/core";
import { filesApi, type DirEntry } from "../../api/files";
import { CommandButton, CommandSeparator } from "../../components/CommandButton";
import type { MenuItem } from "../../components/ContextMenu";
import { ErrorPanel } from "../../components/ErrorPanel";
import { FileList, type Column, type Row } from "../../components/FileList";
import { FilterBox } from "../../components/FilterBox";
import { CopyIcon, DriveIcon, FileIcon, FolderIcon, HomeIcon, NewFolderIcon, RefreshIcon } from "../../components/Icons";
import { TreeNote, TreeRow } from "../../components/TreeRow";
import { formatDate, formatSize } from "../../format";
import type { Place } from "../../shell/places";
import type { SectionUi, Shell } from "../../shell/shell";
import { FilePreviewDialog } from "./FilePreviewDialog";
import { baseName, extOf, pathChain } from "./paths";

export { filesCrumbs, filesParent } from "./paths";

const SECTION = "files";
const RECENT_KEY = "files.recent";
const MAX_RECENT = 8;
const FILTER_KEY = "files|names";

const COLUMNS: Column[] = [
  { id: "name", label: "Name", width: 300 },
  { id: "modified", label: "Date modified", width: 170 },
  { id: "type", label: "Type", width: 110 },
  { id: "size", label: "Size", width: 90, align: "right" },
];

const ROOT_COLUMNS: Column[] = [
  { id: "name", label: "Name", width: 260 },
  { id: "path", label: "Location", width: 420 },
];

interface TreeNodeState {
  folders: string[] | null;
  loading: boolean;
  failed: boolean;
}

export function useFilesSection(shell: Shell): SectionUi {
  const { place, showError, showFlash, copyText } = shell;
  const active = place.section === SECTION;
  const path = active ? place.path : "";
  const go = useCallback((p: string) => shell.navigate({ section: SECTION, path: p } satisfies Place), [shell]);

  const [open, setOpen] = useState(true);
  const [home, setHome] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [listing, setListing] = useState<{ path: string; entries: DirEntry[] | null; error: AppError | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** The filter belongs to the folder it was set in (opening another clears it). */
  const [filterState, setFilterState] = useState({ path: "", value: "" });
  const filter = filterState.path === path ? filterState.value : "";
  const setFilter = (value: string) => setFilterState({ path, value });
  const [showHidden, setShowHidden] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Map<string, TreeNodeState>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // Start-up: home folder, recent folders, filter history.
  useEffect(() => {
    filesApi.homeDir().then(setHome).catch(() => setHome(null));
    appApi
      .getSettings()
      .then((s) => {
        setRecent(Array.isArray(s.values[RECENT_KEY]) ? (s.values[RECENT_KEY] as string[]) : []);
        setHistory(s.filterHistory[FILTER_KEY] ?? []);
      })
      .catch(() => {});
  }, []);

  // Load the open folder.
  useEffect(() => {
    if (!active || !path) return;
    let stale = false;
    setLoading(true);
    filesApi
      .listDir(path)
      .then((entries) => {
        if (stale) return;
        setListing({ path, entries, error: null });
        // The listing also fills this folder's tree node.
        setNodes((m) => new Map(m).set(path, { folders: entries.filter((e) => e.isDir).map((e) => e.path), loading: false, failed: false }));
      })
      .catch((e) => !stale && setListing({ path, entries: null, error: e as AppError }))
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
  }, [active, path, reloadToken]);

  // Opening a folder remembers its top-level root among the recent folders,
  // and expands the tree down to it.
  useEffect(() => {
    if (!active || !path) return;
    setSelected(new Set());
    const chain = pathChain(path);
    const root = recent.find((r) => path === r || chain.some((c) => c.path === r)) ?? path;
    if (!recent.includes(root)) {
      const next = [root, ...recent].slice(0, MAX_RECENT);
      setRecent(next);
      appApi.setValue(RECENT_KEY, next).catch(() => {});
    }
    const below = chain.filter((c) => c.path.length >= root.length).map((c) => c.path);
    setExpanded((s) => new Set([...s, ...below.slice(0, -1)]));
    below.slice(0, -1).forEach((p) => void loadNode(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, path]);

  const loadNode = useCallback(async (p: string) => {
    if (nodesRef.current.get(p)?.folders || nodesRef.current.get(p)?.loading) return;
    setNodes((m) => new Map(m).set(p, { folders: null, loading: true, failed: false }));
    try {
      const entries = await filesApi.listDir(p);
      setNodes((m) => new Map(m).set(p, { folders: entries.filter((e) => e.isDir && !e.hidden).map((e) => e.path), loading: false, failed: false }));
    } catch {
      setNodes((m) => new Map(m).set(p, { folders: [], loading: false, failed: true }));
    }
  }, []);

  const toggle = (p: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
    void loadNode(p);
  };

  const refresh = useCallback(() => {
    setNodes(new Map());
    setReloadToken((t) => t + 1);
  }, []);

  // ---------------------------------------------------------------------------
  // Actions

  async function openFolderDialog() {
    try {
      const p = await appApi.pickFolder("Open a folder");
      if (p) go(p);
    } catch (e) {
      showError(e);
    }
  }

  async function forgetRecent(p: string) {
    const next = recent.filter((r) => r !== p);
    setRecent(next);
    try {
      await appApi.setValue(RECENT_KEY, next);
      showFlash(`Removed ${p} from recent folders.`);
    } catch (e) {
      showError(e);
    }
  }

  async function applyFilter(v: string) {
    setFilter(v);
    try {
      setHistory(await appApi.rememberFilter(FILTER_KEY, v));
    } catch {
      /* convenience only */
    }
  }

  async function forgetFilter(v: string | null) {
    try {
      setHistory(await appApi.forgetFilter(FILTER_KEY, v));
    } catch {
      /* ignore */
    }
  }

  function openEntry(key: string) {
    const e = entries.find((x) => x.path === key);
    if (!e) return;
    if (e.isDir) go(e.path);
    else setPreviewPath(e.path);
  }

  // ---------------------------------------------------------------------------
  // Rows

  const current = listing && listing.path === path ? listing : null;
  const entries = useMemo(() => current?.entries ?? [], [current]);
  const shown = useMemo(() => {
    const text = filter.toLowerCase();
    return entries.filter((e) => (showHidden || !e.hidden) && (!text || e.name.toLowerCase().includes(text)));
  }, [entries, filter, showHidden]);

  const rows: Row[] = useMemo(
    () =>
      shown.map((e) => ({
        key: e.path,
        icon: e.isDir ? <FolderIcon /> : <FileIcon />,
        isContainer: e.isDir,
        dimmed: e.hidden,
        cells: {
          name: { text: e.name, sort: e.name.toLowerCase() },
          modified: { text: formatDate(e.modified), sort: e.modified ?? "" },
          type: { text: e.isDir ? "Folder" : extOf(e.name) ? `${extOf(e.name).toUpperCase()} file` : "File", sort: e.isDir ? "" : extOf(e.name) },
          size: { text: e.isDir ? "" : formatSize(e.size), sort: e.isDir ? -1 : e.size },
        },
      })),
    [shown],
  );

  const roots = useMemo(() => [...(home && !recent.includes(home) ? [home] : []), ...recent], [home, recent]);
  const rootRows: Row[] = useMemo(
    () =>
      roots.map((r) => ({
        key: r,
        icon: r === home ? <HomeIcon /> : <FolderIcon />,
        isContainer: true,
        cells: { name: { text: r === home ? "Home folder" : baseName(r), sort: r }, path: { text: r, sort: r } },
      })),
    [roots, home],
  );

  function openContextMenu(key: string | null, x: number, y: number) {
    const items: MenuItem[] = [];
    if (!path) {
      if (key) {
        items.push(
          { label: "Open", bold: true, shortcut: "Enter", onClick: () => go(key) },
          { label: "Copy path", onClick: () => void copyText(key) },
          ...(recent.includes(key) ? ["separator" as const, { label: "Remove from recent folders", onClick: () => void forgetRecent(key) }] : []),
        );
      } else {
        items.push({ label: "Open folder…", onClick: () => void openFolderDialog() });
      }
    } else if (key) {
      const e = entries.find((x) => x.path === key);
      items.push(
        { label: e?.isDir ? "Open" : "Preview", bold: true, shortcut: "Enter", onClick: () => openEntry(key) },
        "separator",
        { label: "Copy path", onClick: () => void copyText(key) },
        { label: "Copy name", onClick: () => void copyText(baseName(key)) },
      );
    } else {
      items.push({ label: "Copy folder path", onClick: () => void copyText(path) });
    }
    items.push("separator", { label: "Refresh", shortcut: "F5", onClick: refresh });
    shell.openMenu(x, y, items);
  }

  // ---------------------------------------------------------------------------
  // Tree

  function folderNode(p: string, depth: number, label: string, icon: ReactNode): ReactNode {
    const node = nodes.get(p);
    const isOpen = expanded.has(p);
    return (
      <TreeRow
        key={p}
        depth={depth}
        label={label}
        icon={icon}
        title={p}
        selected={active && path === p}
        expanded={isOpen}
        onClick={() => go(p)}
        onToggle={() => toggle(p)}
        onContextMenu={(x, y) =>
          shell.openMenu(x, y, [
            { label: "Open", bold: true, onClick: () => go(p) },
            { label: "Copy path", onClick: () => void copyText(p) },
          ])
        }
      >
        {!node || node.loading ? (
          <TreeNote depth={depth + 1}>Loading…</TreeNote>
        ) : node.failed ? (
          <TreeNote depth={depth + 1}>Can't open this folder</TreeNote>
        ) : (
          node.folders!.map((f) => folderNode(f, depth + 1, baseName(f), <FolderIcon open={expanded.has(f)} />))
        )}
      </TreeRow>
    );
  }

  const tree = (
    <TreeRow
      depth={1}
      label="Local files"
      icon={<DriveIcon />}
      selected={active && !path}
      expanded={open}
      onClick={() => go("")}
      onToggle={() => setOpen((v) => !v)}
    >
      {roots.length === 0 ? <TreeNote depth={2}>Open a folder to start</TreeNote> : roots.map((r) => folderNode(r, 2, r === home ? "Home folder" : baseName(r), r === home ? <HomeIcon /> : <FolderIcon />))}
    </TreeRow>
  );

  // ---------------------------------------------------------------------------
  // Content, status, commands

  let content: ReactNode = null;
  let status = "";
  if (active && !path) {
    content = (
      <FileList
        key="roots"
        columns={ROOT_COLUMNS}
        rows={rootRows}
        selected={selected}
        onSelectionChange={setSelected}
        onOpen={go}
        onContextMenu={openContextMenu}
        emptyText="No folders yet. Use Open folder… to choose one."
      />
    );
    status = `${roots.length} folder${roots.length === 1 ? "" : "s"}`;
  } else if (active) {
    content = current?.error ? (
      <ErrorPanel error={current.error} onRetry={refresh} />
    ) : (
      <div className="section-pane">
        <FilterBox
          label="Filter:"
          applied={filter}
          history={history}
          placeholder="Name contains… (Enter to apply)"
          onApply={(v) => void applyFilter(v)}
          onClear={() => setFilter("")}
          onForget={(v) => void forgetFilter(v)}
          onClearHistory={() => void forgetFilter(null)}
        >
          <label className="check-row">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden
          </label>
        </FilterBox>
        <FileList
          key={path}
          columns={COLUMNS}
          rows={rows}
          selected={selected}
          onSelectionChange={setSelected}
          onOpen={openEntry}
          onContextMenu={openContextMenu}
          emptyText={!current || loading ? "Loading…" : filter ? `Nothing here contains "${filter}".` : "This folder is empty."}
        />
      </div>
    );
    if (current?.entries) {
      const files = shown.filter((e) => !e.isDir);
      const bytes = files.reduce((t, e) => t + e.size, 0);
      status = `${shown.length.toLocaleString()} item${shown.length === 1 ? "" : "s"}${shown.length !== entries.length ? ` (of ${entries.length.toLocaleString()})` : ""} · ${formatSize(bytes)} in files`;
      if (selected.size) status += ` · ${selected.size} selected`;
    }
  }

  const single = selected.size === 1 ? [...selected][0] : null;
  const commands = active ? (
    <>
      <CommandButton icon={<NewFolderIcon />} label="Open folder…" title="Choose a folder to browse" onClick={() => void openFolderDialog()} />
      <CommandSeparator />
      <CommandButton icon={<FileIcon />} label="Open" title="Open the folder or preview the file (Enter)" disabled={!single} onClick={() => single && (path ? openEntry(single) : go(single))} />
      <CommandButton icon={<CopyIcon />} label="Copy path" title="Copy the selected item's path" disabled={!single && !path} onClick={() => void copyText(single ?? path)} />
      <CommandSeparator />
      <CommandButton icon={<RefreshIcon />} label="Refresh" title="Refresh (F5)" onClick={refresh} />
    </>
  ) : null;

  const dialogs = previewPath ? <FilePreviewDialog path={previewPath} onClose={() => setPreviewPath(null)} /> : null;

  return { tree, content, commands, status, busy: active && loading, refresh, dialogs };
}
