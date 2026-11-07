import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ThemePref } from "../api/core";
import type { ViewMode } from "./FileList";
import { HOME, placeCrumbs, type Place } from "../shell/places";
import { BackIcon, CloseIcon, CopyIcon, DashboardIcon, ForwardIcon, GearIcon, PlusIcon, RefreshIcon, UpIcon } from "./Icons";

export interface TabInfo {
  id: number;
  /** Tooltip. */
  title: string;
  /** Shown on the tab (defaults to title). */
  label?: string;
  icon: ReactNode;
}

interface Props {
  tabs: TabInfo[];
  activeTab: number;
  onSelectTab: (id: number) => void;
  onCloseTab: (id: number) => void;
  onNewTab: () => void;
  busy: boolean;
  theme: ThemePref;
  place: Place;
  /** Label for Home in the address bar (the engine's name). */
  homeLabel: string;
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  /** Command-bar buttons from the active section. */
  commands: ReactNode;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  detailsPane: boolean;
  onToggleDetailsPane: () => void;
  /** Copyable address of the current place. */
  uri: string;
  /** Bumped to put the address bar into edit mode (Ctrl+L, Alt+D). */
  editToken: number;
  onThemeChange: (theme: ThemePref) => void;
  onOpenSettings: () => void;
  /** Switches the main window to the dashboard layout. */
  onSwitchLayout: () => void;
  /** Help menu, at the button's bottom-left corner. */
  onOpenHelp: (x: number, y: number) => void;
  onRefresh: () => void;
  onCopyLocation: () => void;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onNavigate: (p: Place) => void;
  /** A typed address; returns false if it leads nowhere (the bar stays open). */
  onSubmitAddress: (text: string) => boolean;
}

const VIEWS: { id: ViewMode; label: string; keys: string }[] = [
  { id: "details", label: "Details", keys: "Ctrl+Shift+6" },
  { id: "list", label: "List", keys: "Ctrl+Shift+5" },
  { id: "tiles", label: "Tiles", keys: "Ctrl+Shift+7" },
];

/** Three rows: tabs (+ theme), command bar, navigation + address bar. */
export function Toolbar(p: Props) {
  return (
    <div className="toolbar">
      <div className="toolbar-row tab-row">
        <div className="tab-strip" role="tablist">
          {p.tabs.map((t) => (
            <div
              key={t.id}
              role="tab"
              aria-selected={t.id === p.activeTab}
              className={`tab ${t.id === p.activeTab ? "active" : ""}`}
              title={t.title}
              onClick={() => p.onSelectTab(t.id)}
              onAuxClick={(e) => e.button === 1 && p.onCloseTab(t.id)}
            >
              {t.icon}
              <span className="tab-title">{t.label ?? t.title}</span>
              <button
                className="tab-close"
                title="Close tab (Ctrl+W)"
                onClick={(e) => {
                  e.stopPropagation();
                  p.onCloseTab(t.id);
                }}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
          <button className="tool-btn tab-new" title="New tab (Ctrl+T)" onClick={p.onNewTab}>
            <PlusIcon />
          </button>
        </div>
        <div className="spacer" />
        {p.busy && <span className="busy">Working…</span>}
        <button className="cmd-btn" title="Switch to the dashboard layout (also in Settings)" onClick={p.onSwitchLayout}>
          <DashboardIcon /> <span className="cmd-label">Dashboard</span>
        </button>
        <button
          className="cmd-btn"
          title="Help: what the colours mean, about this app"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            p.onOpenHelp(r.left, r.bottom);
          }}
        >
          <span className="cmd-label">Help</span>
        </button>
        <button className="cmd-btn" title="Settings: layout, where compose runs" onClick={p.onOpenSettings}>
          <GearIcon /> <span className="cmd-label">Settings</span>
        </button>
        <label className="field-label" htmlFor="theme">
          Theme:
        </label>
        <select
          id="theme"
          className="select theme-select"
          value={p.theme}
          onChange={(e) => p.onThemeChange(e.target.value as ThemePref)}
          title="System follows your OS setting (dark if it can't be detected)"
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>

      <div className="toolbar-row command-bar">
        {p.commands}
        <div className="spacer" />
        <div className="segmented" role="radiogroup" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="radio"
              aria-checked={p.view === v.id}
              className={p.view === v.id ? "active" : ""}
              title={`${v.label} (${v.keys})`}
              onClick={() => p.onViewChange(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <button
          className={`cmd-btn ${p.detailsPane ? "pressed" : ""}`}
          aria-pressed={p.detailsPane}
          title="Show or hide the details pane (Alt+Shift+P)"
          onClick={p.onToggleDetailsPane}
        >
          <span className="cmd-label">Details pane</span>
        </button>
      </div>

      <div className="toolbar-row">
        <button className="tool-btn" title="Back (Alt+Left)" onClick={p.onBack} disabled={!p.canBack}>
          <BackIcon />
        </button>
        <button className="tool-btn" title="Forward (Alt+Right)" onClick={p.onForward} disabled={!p.canForward}>
          <ForwardIcon />
        </button>
        <button className="tool-btn" title="Up one level (Backspace)" onClick={p.onUp} disabled={!p.canUp}>
          <UpIcon />
        </button>
        <AddressBar
          place={p.place}
          homeLabel={p.homeLabel}
          uri={p.uri}
          editToken={p.editToken}
          onNavigate={p.onNavigate}
          onSubmit={p.onSubmitAddress}
        />
        <button className="tool-btn" title={`Copy ${p.uri} to the clipboard`} onClick={p.onCopyLocation}>
          <CopyIcon />
        </button>
        <button className="tool-btn" title="Refresh (F5)" onClick={p.onRefresh}>
          <RefreshIcon />
        </button>
      </div>
    </div>
  );
}

interface AddressProps {
  place: Place;
  homeLabel: string;
  uri: string;
  editToken: number;
  onNavigate: (p: Place) => void;
  onSubmit: (text: string) => boolean;
}

/** Breadcrumbs; click the empty part (or Ctrl+L) to type an address. */
function AddressBar({ place, homeLabel, uri, editToken, onNavigate, onSubmit }: AddressProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function startEdit() {
    setText(uri);
    setBad(false);
    setEditing(true);
  }

  useEffect(() => {
    if (editToken > 0) startEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editToken]);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  // Navigating elsewhere ends editing.
  useEffect(() => setEditing(false), [place]);

  if (editing) {
    return (
      <input
        ref={input}
        className={`address-bar address-input ${bad ? "bad" : ""}`}
        aria-label="Address"
        title={bad ? "There's nothing at that address" : "Type an address, e.g. /containers/@shop/web-1"}
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (onSubmit(text)) setEditing(false);
            else setBad(true);
          } else if (e.key === "Escape") {
            setEditing(false);
          }
        }}
        onBlur={() => setEditing(false)}
      />
    );
  }

  const crumbs = placeCrumbs(place);
  return (
    <div
      className="address-bar"
      role="navigation"
      aria-label="Address"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest(".crumb")) startEdit();
      }}
    >
      <button className="crumb" onClick={() => onNavigate(HOME)}>
        {homeLabel}
      </button>
      {crumbs.map((c, i) => (
        <span key={i} className="crumb-wrap">
          <span className="crumb-sep">›</span>
          <button className="crumb" onClick={() => onNavigate(c.place)}>
            {c.label}
          </button>
        </span>
      ))}
    </div>
  );
}
