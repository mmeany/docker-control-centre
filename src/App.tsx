// App shell: theme, layout (toolbar, tree, main panel, status bar), navigation
// history across sections, and shared dialogs. Each section (src/sections/*)
// supplies its tree branch, content, commands and status through a hook
// registered in src/sections/index.ts.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { appApi } from "./api/app";
import type { AppError, Settings, ThemePref } from "./api/core";
import { ConfirmDialog, type ConfirmButton } from "./components/ConfirmDialog";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { FileList, type Column, type Row } from "./components/FileList";
import { HomeIcon } from "./components/Icons";
import { PromptDialog } from "./components/PromptDialog";
import { StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { TreeRow } from "./components/TreeRow";
import { TypedConfirmDialog } from "./components/TypedConfirmDialog";
import { SECTIONS } from "./sections";
import { HOME, parentPlace, placeUri, rootOf, samePlace, sectionOf, type Place } from "./shell/places";
import type { SectionUi, Shell } from "./shell/shell";
import { useHistory } from "./state/history";
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
  const nav = useHistory<Place>(HOME, samePlace);
  const place = nav.current;
  const treeRef = useRef<HTMLDivElement>(null);

  const themePref: ThemePref = settings?.theme ?? "system";
  useTheme(themePref);

  useEffect(() => {
    appApi
      .getSettings()
      .then(setSettings)
      .catch(() => setSettings({ theme: "system", filterHistory: {}, values: {} }));
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

  // Explorer keyboard shortcuts (ignored while typing in inputs or dialogs).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [role=dialog], [role=alertdialog]")) return;
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
  }, [goUp, nav, refresh]);

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

  const homeRows: Row[] = useMemo(
    () =>
      SECTIONS.map((s) => ({
        key: s.id,
        icon: s.icon,
        isContainer: true,
        cells: { name: { text: s.name, sort: s.name }, desc: { text: s.description, sort: s.description } },
      })),
    [],
  );

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
    />
  );

  let statusLeft = active ? active.status : `${SECTIONS.length} section${SECTIONS.length === 1 ? "" : "s"}`;
  if (working) statusLeft = working;
  else if (flash) statusLeft = flash;

  return (
    <div className="app">
      <Toolbar
        title={APP_TITLE}
        busy={working !== null || (active?.busy ?? false)}
        theme={themePref}
        onThemeChange={(t) => void changeTheme(t)}
        place={place}
        canBack={nav.canBack}
        canForward={nav.canForward}
        canUp={parentPlace(place) !== null}
        commands={active?.commands}
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
          <div className="tree" role="tree">
            <TreeRow depth={0} label="Home" icon={<HomeIcon />} selected={place.section === null} expanded onClick={() => nav.navigate(HOME)}>
              {SECTIONS.map((s) => (
                <div key={s.id}>{sectionUis[s.id].tree}</div>
              ))}
            </TreeRow>
          </div>
        </div>
        <div className="splitter" onMouseDown={startResize} />
        <div className="pane-main">{content}</div>
      </div>
      <StatusBar left={statusLeft} right={APP_TITLE} />
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
    </div>
  );
}
