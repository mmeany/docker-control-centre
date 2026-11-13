// Everything the app shell does that doesn't depend on the layout: settings
// and theme, the session (tabs, views, details pane, tree level), navigation
// history, the Shell offered to sections, every section's hook, keyboard
// shortcuts, status-bar text and the shared dialogs. A layout component
// (ExplorerLayout) takes what this returns and places it on screen.
import { seedColumnLayouts } from "../state/columns";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { appApi } from "../api/app";
import { composeApi, type Pinned } from "../api/compose";
import type { AppError, Settings, ThemePref } from "../api/core";
import { engineApi } from "../api/engine";
import { streamsApi } from "../api/streams";
import { onFileDrop, type FileDropHandlers } from "../api/window";
import { AboutDialog } from "../components/AboutDialog";
import { ConfirmDialog, type ConfirmButton } from "../components/ConfirmDialog";
import { ContextMenu, type MenuItem } from "../components/ContextMenu";
import type { ViewMode } from "../components/FileList";
import { HelpDialog } from "../components/HelpDialog";
import { PromptDialog } from "../components/PromptDialog";
import { TypedConfirmDialog } from "../components/TypedConfirmDialog";
import { generalTopic, placeTopic } from "../help";
import { openHelp as openHelpTopic, registeredHelpTopic, useOpenHelp } from "../help/store";
import { SECTIONS } from "../sections";
import { SettingsDialog } from "../settings/SettingsDialog";
import { useEngine, type EngineState } from "../state/engine";
import { useEngineList, type EngineList } from "../state/engineList";
import { DETAILS_PANE_KEY, readSession, readViews, SESSION_KEY, VIEWS_KEY, withView, type SavedSession } from "../state/session";
import { useTabs } from "../state/tabs";
import { useTheme } from "../state/theme";
import { readTreeLevel, TREE_LEVEL_KEY, type TreeLevel } from "../status/filter";
import { LegendDialog } from "../status/LegendDialog";
import { liveProjects } from "../status/status";
import type { ContainerItem } from "../api/engine";
import { HOME, parentPlace, parseAddress, placeCrumbs, placeUri, samePlace, sectionOf, type Place } from "./places";
import { LAYOUT_KEY, readLayout, type Layout } from "./layout";
import type { SectionUi, Shell } from "./shell";

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

/** In a pop-out window (?popout=<address>): the one place it shows. */
const POPOUT_PLACE: Place | null = (() => {
  const a = new URLSearchParams(window.location.search).get("popout");
  return a ? parseAddress(a) : null;
})();

/** What a layout gets from the shell. */
export interface AppShell {
  /** True in a pop-out window: one place, no session. */
  popout: boolean;
  /** Settings have loaded (until then the layout isn't known). */
  ready: boolean;
  settings: Settings | null;
  layout: Layout;
  changeLayout: (layout: Layout) => void;
  themePref: ThemePref;
  changeTheme: (theme: ThemePref) => void;
  nav: ReturnType<typeof useTabs<Place>>;
  place: Place;
  engine: EngineState;
  containers: EngineList<ContainerItem>;
  /** Pinned compose files. */
  composePinned: Pinned[];
  /** Engine name, or "Docker" before it's known. */
  homeLabel: string;
  /** Every section's UI, by id (all hooks run on every render). */
  sectionUis: Record<string, SectionUi>;
  /** The open section's UI; null at Home. */
  active: SectionUi | null;
  view: ViewMode;
  changeView: (mode: ViewMode) => void;
  detailsPane: boolean;
  toggleDetailsPane: () => void;
  treeLevel: TreeLevel;
  changeTreeLevel: (level: TreeLevel) => void;
  /** A long-running action is in progress (shell or section). */
  busy: boolean;
  /** Bumps when Ctrl+L / Alt+D asks for the address to be typed. */
  editAddress: number;
  refresh: () => void;
  goUp: () => void;
  submitAddress: (text: string) => boolean;
  copyText: (text: string) => Promise<void>;
  openSettings: () => void;
  /** Help menu at a point (this view, general, legend, about). */
  openHelp: (x: number, y: number) => void;
  /** Help for the current view or open dialog (F1). */
  showHelp: () => void;
  /** Status bar: left text (section status, or working / flash), and the connection. */
  statusLeft: string;
  connection: ReactNode;
  connectionTitle: string | undefined;
  /** Settings, legend, menus, prompts, confirms and every section's dialogs. */
  overlays: ReactNode;
}

export function useAppShell(): AppShell {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [typedConfirm, setTypedConfirm] = useState<TypedConfirmState | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  const [editAddress, setEditAddress] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
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

  const themePref: ThemePref = settings?.theme ?? "system";
  useTheme(themePref);
  const layout = readLayout(settings?.values[LAYOUT_KEY]);
  const explorer = layout === "explorer";

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
        seedColumnLayouts(s.values);
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

  // The dashboard has no view switcher: lists it falls back to are details.
  const view: ViewMode = explorer ? (views[placeUri(place)] ?? "details") : "details";
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

  async function changeLayout(next: Layout) {
    // Apply immediately; persisting is best-effort.
    setSettings((s) => {
      const base = s ?? { theme: "system" as const, filterHistory: {}, values: {} };
      return { ...base, values: { ...base.values, [LAYOUT_KEY]: next } };
    });
    try {
      setSettings(await appApi.setValue(LAYOUT_KEY, next));
    } catch {
      /* keep the in-memory choice even if saving failed */
    }
  }

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

  // Files dropped from the OS: one listener for the window. A mounted claim
  // (container Files) takes them; otherwise a section's fileDrop does
  // (compose), except in a pop-out, which shows its one place only.
  // Everything is ignored while a dialog is open.
  const dropClaims = useRef<FileDropHandlers[]>([]);
  const appDrop = useRef<((paths: string[]) => void) | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const claimDrops = useCallback((h: FileDropHandlers) => {
    dropClaims.current.push(h);
    return () => {
      dropClaims.current = dropClaims.current.filter((x) => x !== h);
    };
  }, []);
  useEffect(() => {
    const claim = () => dropClaims.current[dropClaims.current.length - 1];
    const inDialog = () => document.querySelector("[role=dialog], [role=alertdialog]") !== null;
    return onFileDrop({
      over: (x, y) => {
        const c = claim();
        if (inDialog()) {
          c?.leave();
          setDragging(false);
        } else if (c) c.over(x, y);
        else setDragging(appDrop.current !== undefined);
      },
      leave: () => {
        claim()?.leave();
        setDragging(false);
      },
      drop: (paths, x, y) => {
        setDragging(false);
        const c = claim();
        if (inDialog()) c?.leave();
        else if (c) c.drop(paths, x, y);
        else appDrop.current?.(paths);
      },
    });
  }, []);

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
    claimDrops,
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
  appDrop.current = POPOUT_PLACE ? undefined : Object.values(sectionUis).find((s) => s.fileDrop)?.fileDrop;

  // ---------------------------------------------------------------------------
  // Navigation

  const refresh = useCallback(() => active?.refresh(), [active]);

  const goUp = useCallback(() => {
    const p = parentPlace(place);
    if (p) nav.navigate(p);
  }, [nav, place]);

  function submitAddress(text: string): boolean {
    const p = parseAddress(text);
    if (p) nav.navigate(p);
    return p !== null;
  }

  // Explorer keyboard shortcuts. Tab and address shortcuts work anywhere but in
  // dialogs; the rest are ignored while typing. The dashboard has no tabs,
  // address bar or view modes, so those keys do nothing there.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      // Dialogs, and terminals (the shell owns Ctrl+W, Ctrl+L, …), keep their keys.
      if (t.closest("[role=dialog], [role=alertdialog], .xterm")) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (!explorer && ((ctrl && ["t", "w", "f4", "l"].includes(k)) || (ctrl && e.key === "Tab") || (e.altKey && k === "d"))) {
        e.preventDefault();
        return;
      }
      if (explorer && ctrl && e.shiftKey && ["Digit5", "Digit6", "Digit7"].includes(e.code)) {
        e.preventDefault();
        changeView(({ Digit5: "list", Digit6: "details", Digit7: "tiles" } as const)[e.code as "Digit5"]);
        return;
      }
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
  }, [goUp, nav, refresh, place, changeView, toggleDetailsPane, active, explorer]);

  // ---------------------------------------------------------------------------
  // Help (F1): the newest registered topic (an open dialog), else the place's,
  // or Connecting while the engine isn't. Pop-outs use the Explorer topics.

  const helpLayout: Layout = POPOUT_PLACE ? "explorer" : layout;
  const helpTopic = useOpenHelp();
  const showHelp = useCallback(() => {
    openHelpTopic(registeredHelpTopic() ?? (engine.status === "connected" ? placeTopic(place, helpLayout) : "connecting"));
  }, [engine.status, place, helpLayout]);
  // F1 works everywhere, in dialogs and terminals too: the capture phase sees
  // it before xterm does, and stopping it here keeps it from the shell.
  useEffect(() => {
    function onF1(e: KeyboardEvent) {
      if (e.key !== "F1") return;
      e.preventDefault();
      e.stopPropagation();
      if (!document.querySelector(".help-dialog")) showHelp();
    }
    window.addEventListener("keydown", onF1, true);
    return () => window.removeEventListener("keydown", onF1, true);
  }, [showHelp]);

  // ---------------------------------------------------------------------------
  // Status bar, help, dialogs

  let statusLeft = active ? active.status : `${SECTIONS.length} section${SECTIONS.length === 1 ? "" : "s"}`;
  if (!active && engine.info) {
    const i = engine.info;
    statusLeft += ` · Docker ${i.serverVersion} on ${i.operatingSystem} · ${i.containers.toLocaleString()} containers (${i.running.toLocaleString()} running) · ${i.images.toLocaleString()} images`;
  }
  if (working) statusLeft = working;
  else if (flash) statusLeft = flash;

  const endpoint = engine.info?.endpoint ?? "";
  const connection = (
    <>
      <span className={`conn-dot ${engine.status}`} />
      {engine.status === "connected" ? `${homeLabel} · ${endpoint}` : engine.status === "connecting" ? "Connecting…" : "Not connected"}
    </>
  );
  const connectionTitle = engine.status === "connected" ? `Connected to ${endpoint}` : engine.message;

  const openHelp = (x: number, y: number) =>
    setMenu({
      x,
      y,
      items: [
        { label: "Help for this view", shortcut: "F1", onClick: showHelp },
        { label: "General help", onClick: () => openHelpTopic(generalTopic(helpLayout)) },
        "separator",
        { label: "What the colours mean…", onClick: () => setLegendOpen(true) },
        "separator",
        { label: "About Docker Control Centre", onClick: () => setAboutOpen(true) },
      ],
    });

  const overlays = (
    <>
      {dragging && (
        <div className="drop-overlay" aria-hidden>
          <div className="drop-overlay-note">Drop a compose file or folder to start it</div>
        </div>
      )}
      {legendOpen && <LegendDialog onClose={() => setLegendOpen(false)} />}
      {aboutOpen && <AboutDialog endpoint={engine.info?.endpoint ?? null} onClose={() => setAboutOpen(false)} onError={showError} />}
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
      {helpTopic && <HelpDialog topic={helpTopic} general={generalTopic(helpLayout)} />}
    </>
  );

  return {
    popout: POPOUT_PLACE !== null,
    ready: settings !== null,
    settings,
    layout,
    changeLayout: (l) => void changeLayout(l),
    themePref,
    changeTheme: (t) => void changeTheme(t),
    nav,
    place,
    engine,
    containers,
    composePinned,
    homeLabel,
    sectionUis,
    active,
    view,
    changeView,
    detailsPane,
    toggleDetailsPane,
    treeLevel,
    changeTreeLevel,
    busy: working !== null || (active?.busy ?? false),
    editAddress,
    refresh,
    goUp,
    submitAddress,
    copyText,
    openSettings: () => setSettingsOpen(true),
    openHelp,
    showHelp,
    statusLeft,
    connection,
    connectionTitle,
    overlays,
  };
}
