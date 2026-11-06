// App shell: theme, layout (toolbar, tree, main panel, status bar), navigation
// history across sections, and shared dialogs. Each section (src/sections/*)
// supplies its tree branch, content, commands and status through a hook
// registered in src/sections/index.ts.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { appApi } from "./api/app";
import type { AppError, Settings, ThemePref } from "./api/core";
import { ConfirmDialog, type ConfirmButton } from "./components/ConfirmDialog";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { FileList, type Column, type Row, type ViewMode } from "./components/FileList";
import { ServerIcon } from "./components/Icons";
import { PromptDialog } from "./components/PromptDialog";
import { StatusBar } from "./components/StatusBar";
import { Toolbar, type TabInfo } from "./components/Toolbar";
import { TreeRow } from "./components/TreeRow";
import { TypedConfirmDialog } from "./components/TypedConfirmDialog";
import { SECTIONS } from "./sections";
import { HOME, parentPlace, parseAddress, placeCrumbs, placeUri, rootOf, samePlace, sectionOf, type Place } from "./shell/places";
import type { SectionUi, Shell } from "./shell/shell";
import { streamsApi } from "./api/streams";
import { composeApi, type Pinned } from "./api/compose";
import { engineApi } from "./api/engine";
import { liveProjects } from "./status/status";
import { readTreeLevel, TREE_LEVEL_KEY, TREE_LEVELS, type TreeLevel } from "./status/filter";
import { StatusMark, statusTip } from "./components/StatusMark";
import { attentionText } from "./components/SectionBadge";
import { useEngine } from "./state/engine";
import { useEngineList } from "./state/engineList";
import { DETAILS_PANE_KEY, readSession, readViews, SESSION_KEY, VIEWS_KEY, withView, type SavedSession } from "./state/session";
import { useTabs } from "./state/tabs";
import { SettingsDialog } from "./settings/SettingsDialog";
import { LegendDialog } from "./status/LegendDialog";
import { getVersion } from "@tauri-apps/api/app";
import { useTheme } from "./state/theme";

/** Shown in the toolbar; the window title comes from tauri.conf.json. */
export const APP_TITLE = "Docker Control Centre";

interface ConfirmState {
  title: string;
  body: ReactNode;
  buttons: ConfirmButton<string>[];
  cancelValue: string;
  resolve: (value: string) => void;
}

interface PromptState {
  title: string;
  label: string;
  initial: string;
  okLabel: string;
  validate: (v: string) => string | null;
  resolve: (v: string | null) => void;
}

interface TypedConfirmState {
  title: string;
  body: ReactNode;
  confirmText: string;
  actionLabel: string;
  resolve: (ok: boolean) => void;
}

const TREE_WIDTH_KEY = "app.treeWidth";

/** In a pop-out window (?popout=<address>): the one place it shows. */
const POPOUT_PLACE: Place | null = (() => {
  const a = new URLSearchParams(window.location.search).get("popout");
  return a ? parseAddress(a) : null;
})();

function loadTreeWidth(): number {
  try {
    const v = Number(localStorage.getItem(TREE_WIDTH_KEY));
    return v >= 160 && v <= 600 ? v : 260;
  } catch {
    return 260;
  }
}

const HOME_COLUMNS: Column[] = [
  { id: "name", label: "Name", width: 220 },
  { id: "attention", label: "Needs attention", width: 200 },
  { id: "desc", label: "Description", width: 460 },
];

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [treeWidth, setTreeWidth] = useState(loadTreeWidth);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [typedConfirm, setTypedConfirm] = useState<TypedConfirmState | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [homeSelected, setHomeSelected] = useState<Set<string>>(new Set());
  const flashTimer = useRef<number | undefined>(undefined);
  const [editAddress, setEditAddress] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const nav = useTabs<Place>(POPOUT_PLACE ?? HOME, samePlace);
  const place = nav.current;
  const engine = useEngine();
  const containers = useEngineList(engine, engine.changes.container, engineApi.listContainers);
  const [composePinned, setComposePinned] = useState<Pinned[]>([]);
  useEffect(() => {
    composeApi
      .pinned()
      .then(setComposePinned)
      .catch(() => {});
  }, []);
  const live = useMemo(() => liveProjects(containers.items ?? [], composePinned.map((p) => p.name)), [containers.items, composePinned]);
  const homeLabel = engine.info?.name ?? "Docker";
  const treeRef = useRef<HTMLDivElement>(null);

  const themePref: ThemePref = settings?.theme ?? "system";
  useTheme(themePref);

  // Session: tabs, views and the details pane come back from settings once,
  // then are saved (debounced) whenever they change.
  const [views, setViews] = useState<Record<string, ViewMode>>({});
  const [detailsPane, setDetailsPane] = useState(false);
  const [treeLevel, setTreeLevel] = useState<TreeLevel>("running");
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    appApi
      .getSettings()
      .then((s) => {
        setSettings(s);
        const session = readSession(s.values[SESSION_KEY]);
        // A pop-out shows its own place and doesn't touch the main window's session.
        if (session && !POPOUT_PLACE) nav.restore(session.places, session.active);
        setViews(readViews(s.values[VIEWS_KEY]));
        setDetailsPane(s.values[DETAILS_PANE_KEY] === true);
        setTreeLevel(readTreeLevel(s.values[TREE_LEVEL_KEY]));
      })
      .catch(() => setSettings({ theme: "system", filterHistory: {}, values: {} }))
      .finally(() => setRestored(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabUris = nav.tabs.map((t) => placeUri(t.stack[t.index]));
  const activeIndex = nav.tabs.findIndex((t) => t.id === nav.active);
  const sessionJson = JSON.stringify({ tabs: tabUris, active: activeIndex } satisfies SavedSession);
  useEffect(() => {
    if (!restored || POPOUT_PLACE) return;
    const t = window.setTimeout(() => {
      appApi.setValue(SESSION_KEY, JSON.parse(sessionJson)).catch(() => {});
    }, 500);
    return () => window.clearTimeout(t);
  }, [restored, sessionJson]);

  const view: ViewMode = views[placeUri(place)] ?? "details";
  const changeView = useCallback(
    (mode: ViewMode) => {
      const next = withView(views, placeUri(place), mode);
      setViews(next);
      appApi.setValue(VIEWS_KEY, next).catch(() => {});
    },
    [views, place],
  );
  const changeTreeLevel = (level: TreeLevel) => {
    setTreeLevel(level);
    appApi.setValue(TREE_LEVEL_KEY, level).catch(() => {});
  };
  const toggleDetailsPane = useCallback(() => {
    setDetailsPane((v) => {
      appApi.setValue(DETAILS_PANE_KEY, !v).catch(() => {});
      return !v;
    });
  }, []);

  async function changeTheme(theme: ThemePref) {
    // Apply immediately; persisting is best-effort.
    setSettings((s) => ({ ...(s ?? { filterHistory: {}, values: {} }), theme }));
    try {
      setSettings(await appApi.setTheme(theme));
    } catch {
      /* keep the in-memory choice even if saving failed */
    }
  }

  // ---------------------------------------------------------------------------
  // Shared dialogs and messages (offered to sections through the Shell)

  const ask = useCallback(
    (title: string, body: ReactNode, buttons: ConfirmButton<string>[], cancelValue: string) =>
      new Promise<string>((resolve) => setConfirm({ title, body, buttons, cancelValue, resolve })),
    [],
  );
  const askName = useCallback(
    (title: string, label: string, initial: string, okLabel: string, validate: (v: string) => string | null) =>
      new Promise<string | null>((resolve) => setPrompt({ title, label, initial, okLabel, validate, resolve })),
    [],
  );
  const confirmTyped = useCallback(
    (title: string, body: ReactNode, confirmText: string, actionLabel: string) =>
      new Promise<boolean>((resolve) => setTypedConfirm({ title, body, confirmText, actionLabel, resolve })),
    [],
  );
  const showError = useCallback(
    (e: unknown) => {
      const msg = (e as AppError)?.message ?? String(e);
      void ask("Something went wrong", <p>{msg}</p>, [{ label: "OK", value: "ok", primary: true }], "ok");
    },
    [ask],
  );
  const showFlash = useCallback((msg: string) => {
    setFlash(msg);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2500);
  }, []);
  const copyText = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        showFlash(`Copied ${text}`);
      } catch (e) {
        showError(e);
      }
    },
    [showFlash, showError],
  );

  const shell: Shell = {
    place,
    navigate: nav.navigate,
    openInNewTab: (p) => nav.openTab(p),
    popOut: POPOUT_PLACE
      ? undefined
      : (p) => {
          const title = placeCrumbs(p)
            .slice(-2)
            .map((c) => c.label)
            .join(" › ");
          streamsApi.openPopout(placeUri(p), title).catch((e) => showError(e));
        },
    engine,
    containers,
    composePinned,
    setComposePinned,
    liveProjects: live,
    treeLevel,
    view,
    ask,
    askName,
    confirmTyped,
    showError,
    showFlash,
    setWorking,
    openMenu: (x, y, items) => setMenu({ x, y, items }),
    copyText,
  };

  // ---------------------------------------------------------------------------
  // Sections: every hook runs on every render, in registry order.

  const sectionUis: Record<string, SectionUi> = {};
  for (const s of SECTIONS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    sectionUis[s.id] = s.use(shell);
  }
  const activeDef = sectionOf(place);
  const active: SectionUi | null = activeDef ? sectionUis[activeDef.id] : null;

  // ---------------------------------------------------------------------------
  // Navigation

  const refresh = useCallback(() => active?.refresh(), [active]);

  const goUp = useCallback(() => {
    const p = parentPlace(place);
    if (p) nav.navigate(p);
  }, [nav, place]);

  // Explorer keyboard shortcuts. Tab and address shortcuts work anywhere but in
  // dialogs; the rest are ignored while typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      // Dialogs, and terminals (the shell owns Ctrl+W, Ctrl+L, …), keep their keys.
      if (t.closest("[role=dialog], [role=alertdialog], .xterm")) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && k === "t") {
        e.preventDefault();
        nav.openTab(place);
        return;
      } else if (ctrl && (k === "w" || k === "f4")) {
        e.preventDefault();
        nav.closeActive();
        return;
      } else if (ctrl && e.key === "Tab") {
        e.preventDefault();
        nav.cycleTab(e.shiftKey ? -1 : 1);
        return;
      } else if ((ctrl && k === "l") || (e.altKey && k === "d")) {
        e.preventDefault();
        setEditAddress((n) => n + 1);
        return;
      } else if (ctrl && e.shiftKey && ["Digit5", "Digit6", "Digit7"].includes(e.code)) {
        e.preventDefault();
        changeView(({ Digit5: "list", Digit6: "details", Digit7: "tiles" } as const)[e.code as "Digit5"]);
        return;
      } else if (e.altKey && e.shiftKey && k === "p") {
        e.preventDefault();
        toggleDetailsPane();
        return;
      }
      if (t.closest("input, textarea, select")) return;
      if (e.key === "Delete" && active?.onDelete) {
        e.preventDefault();
        active.onDelete();
        return;
      }
      if (e.key === "Backspace" || (e.altKey && e.key === "ArrowUp")) {
        e.preventDefault();
        goUp();
      } else if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        nav.back();
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        nav.forward();
      } else if (e.key === "F5") {
        e.preventDefault();
        refresh();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goUp, nav, refresh, place, changeView, toggleDetailsPane, active]);

  // Keep the selected tree node in view.
  useEffect(() => {
    treeRef.current?.querySelector(".tree-row.selected")?.scrollIntoView({ block: "nearest" });
  }, [place]);

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = treeWidth;
    const clamp = (x: number) => Math.min(600, Math.max(160, startW + x - startX));
    const move = (ev: MouseEvent) => setTreeWidth(clamp(ev.clientX));
    const up = (ev: MouseEvent) => {
      try {
        localStorage.setItem(TREE_WIDTH_KEY, String(clamp(ev.clientX)));
      } catch {
        /* storage unavailable: width just isn't remembered */
      }
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // ---------------------------------------------------------------------------
  // Layout

  const homeRows: Row[] = SECTIONS.map((s) => {
    const a = sectionUis[s.id].attention ?? { errors: 0, orphans: 0 };
    const text = attentionText(a);
    return {
      key: s.id,
      icon: s.icon,
      isContainer: true,
      status: a.errors
        ? { state: "error" as const, label: "Problem", reason: text }
        : a.orphans
          ? { state: "orphaned" as const, label: "Orphaned", reason: text }
          : undefined,
      cells: { name: { text: s.name, sort: s.name }, attention: { text, sort: a.errors * 1000 + a.orphans }, desc: { text: s.description, sort: s.description } },
    };
  });

  const content: ReactNode = active ? (
    active.content
  ) : (
    <FileList
      columns={HOME_COLUMNS}
      rows={homeRows}
      selected={homeSelected}
      onSelectionChange={setHomeSelected}
      onOpen={(id) => nav.navigate(rootOf(SECTIONS.find((s) => s.id === id)!))}
      emptyText="No sections"
      view={view}
    />
  );

  let statusLeft = active ? active.status : `${SECTIONS.length} section${SECTIONS.length === 1 ? "" : "s"}`;
  if (!active && engine.info) {
    const i = engine.info;
    statusLeft += ` · Docker ${i.serverVersion} on ${i.operatingSystem} · ${i.containers.toLocaleString()} containers (${i.running.toLocaleString()} running) · ${i.images.toLocaleString()} images`;
  }
  if (working) statusLeft = working;
  else if (flash) statusLeft = flash;

  const tabInfos: TabInfo[] = nav.tabs.map((t) => {
    const p = t.stack[t.index];
    const crumbs = placeCrumbs(p);
    const st = p.section ? sectionUis[p.section]?.placeStatus?.(p.path) : undefined;
    const title = crumbs.length ? crumbs[crumbs.length - 1].label : homeLabel;
    return {
      id: t.id,
      title: st ? `${title} · ${statusTip(st)}` : title,
      label: title,
      icon: (
        <>
          {st && <StatusMark status={st} />}
          {sectionOf(p)?.icon ?? <ServerIcon />}
        </>
      ),
    };
  });

  async function showAbout() {
    let version = "development build";
    try {
      version = `version ${await getVersion()}`;
    } catch {
      /* not running in Tauri */
    }
    await ask(
      "About Docker Control Centre",
      <>
        <p>
          Docker Control Centre, {version}. Manage a Docker engine the way File Explorer manages files.
        </p>
        <p className="hint">MIT or Apache-2.0. Connected to {engine.info?.endpoint ?? "no engine"}.</p>
      </>,
      [{ label: "OK", value: "ok", primary: true }],
      "ok",
    );
  }

  function submitAddress(text: string): boolean {
    const p = parseAddress(text);
    if (p) nav.navigate(p);
    return p !== null;
  }

  const endpoint = engine.info?.endpoint ?? "";
  const connection = (
    <>
      <span className={`conn-dot ${engine.status}`} />
      {engine.status === "connected" ? `${homeLabel} · ${endpoint}` : engine.status === "connecting" ? "Connecting…" : "Not connected"}
    </>
  );
  const connectionTitle = engine.status === "connected" ? `Connected to ${endpoint}` : engine.message;

  const overlays = (
    <>
      {legendOpen && <LegendDialog onClose={() => setLegendOpen(false)} />}
      {settingsOpen && settings && (
        <SettingsDialog
          settings={settings}
          onSaved={setSettings}
          onClose={() => {
            setSettingsOpen(false);
            // The compose section reads the distro for showing paths.
            active?.refresh();
          }}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {SECTIONS.map((s) => (
        <div key={s.id} style={{ display: "contents" }}>
          {sectionUis[s.id].dialogs}
        </div>
      ))}
      {prompt && (
        <PromptDialog
          title={prompt.title}
          label={prompt.label}
          initial={prompt.initial}
          okLabel={prompt.okLabel}
          validate={prompt.validate}
          onResult={(v) => {
            setPrompt(null);
            prompt.resolve(v);
          }}
        />
      )}
      {typedConfirm && (
        <TypedConfirmDialog
          title={typedConfirm.title}
          confirmText={typedConfirm.confirmText}
          actionLabel={typedConfirm.actionLabel}
          onResult={(ok) => {
            setTypedConfirm(null);
            typedConfirm.resolve(ok);
          }}
        >
          {typedConfirm.body}
        </TypedConfirmDialog>
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          buttons={confirm.buttons}
          cancelValue={confirm.cancelValue}
          onResult={(v) => {
            setConfirm(null);
            confirm.resolve(v);
          }}
        >
          {confirm.body}
        </ConfirmDialog>
      )}
    </>
  );

  if (POPOUT_PLACE) {
    return (
      <div className="app popout">
        <div className="panes">
          <div className="pane-main">{content}</div>
        </div>
        <StatusBar left={statusLeft} right={connection} rightTitle={connectionTitle} />
        {overlays}
      </div>
    );
  }

  return (
    <div className="app">
      <Toolbar
        tabs={tabInfos}
        activeTab={nav.active}
        onSelectTab={nav.selectTab}
        onCloseTab={nav.closeTab}
        onNewTab={() => nav.openTab(place)}
        homeLabel={homeLabel}
        editToken={editAddress}
        onSubmitAddress={submitAddress}
        busy={working !== null || (active?.busy ?? false)}
        theme={themePref}
        onThemeChange={(t) => void changeTheme(t)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHelp={(x, y) =>
          setMenu({
            x,
            y,
            items: [
              { label: "What the colours mean…", onClick: () => setLegendOpen(true) },
              "separator",
              { label: "About Docker Control Centre", onClick: () => void showAbout() },
            ],
          })
        }
        place={place}
        canBack={nav.canBack}
        canForward={nav.canForward}
        canUp={parentPlace(place) !== null}
        commands={active?.commands}
        view={view}
        onViewChange={changeView}
        detailsPane={detailsPane}
        onToggleDetailsPane={toggleDetailsPane}
        uri={placeUri(place)}
        onRefresh={refresh}
        onCopyLocation={() => void copyText(placeUri(place))}
        onBack={nav.back}
        onForward={nav.forward}
        onUp={goUp}
        onNavigate={nav.navigate}
      />
      <div className="panes">
        <div className="pane-tree" style={{ width: treeWidth }} ref={treeRef}>
          <div className="tree-show">
            <label className="field-label" htmlFor="tree-level">
              Show:
            </label>
            <select
              id="tree-level"
              className="select"
              value={treeLevel}
              title={TREE_LEVELS.find((l) => l.id === treeLevel)?.title}
              onChange={(e) => changeTreeLevel(e.target.value as TreeLevel)}
            >
              {TREE_LEVELS.map((l) => (
                <option key={l.id} value={l.id} title={l.title}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div className="tree" role="tree">
            <TreeRow depth={0} label={homeLabel} icon={<ServerIcon />} title={engine.info?.endpoint} selected={place.section === null} expanded onClick={() => nav.navigate(HOME)}>
              {SECTIONS.map((s) => (
                <div key={s.id}>{sectionUis[s.id].tree}</div>
              ))}
            </TreeRow>
          </div>
        </div>
        <div className="splitter" onMouseDown={startResize} />
        <div className="pane-main">{content}</div>
        {detailsPane && (
          <aside className="pane-details" aria-label="Details">
            {active?.details ?? <div className="empty-note">Select an item to see its details.</div>}
          </aside>
        )}
      </div>
      <StatusBar left={statusLeft} right={connection} rightTitle={connectionTitle} />
      {overlays}
    </div>
  );
}
