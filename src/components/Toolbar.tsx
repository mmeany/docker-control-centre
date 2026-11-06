import type { ReactNode } from "react";
import type { ThemePref } from "../api/core";
import { HOME, placeCrumbs, type Place } from "../shell/places";
import { BackIcon, CopyIcon, ForwardIcon, RefreshIcon, UpIcon } from "./Icons";

interface Props {
  title: string;
  busy: boolean;
  theme: ThemePref;
  place: Place;
  canBack: boolean;
  canForward: boolean;
  canUp: boolean;
  /** Command-bar buttons from the active section. */
  commands: ReactNode;
  /** Copyable address of the current place ("" disables the button). */
  uri: string;
  onThemeChange: (theme: ThemePref) => void;
  onRefresh: () => void;
  onCopyLocation: () => void;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
  onNavigate: (p: Place) => void;
}

/** Three rows: app row (title, theme), command bar, navigation + address bar. */
export function Toolbar(p: Props) {
  return (
    <div className="toolbar">
      <div className="toolbar-row">
        <span className="app-title">{p.title}</span>
        <div className="spacer" />
        {p.busy && <span className="busy">Working…</span>}
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

      <div className="toolbar-row command-bar">{p.commands}</div>

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
        <AddressBar place={p.place} onNavigate={p.onNavigate} />
        <button
          className="tool-btn"
          title={p.uri ? `Copy ${p.uri} to the clipboard` : "Copy this location to the clipboard"}
          onClick={p.onCopyLocation}
          disabled={!p.uri}
        >
          <CopyIcon />
        </button>
        <button className="tool-btn" title="Refresh (F5)" onClick={p.onRefresh}>
          <RefreshIcon />
        </button>
      </div>
    </div>
  );
}

function AddressBar({ place, onNavigate }: { place: Place; onNavigate: (p: Place) => void }) {
  const crumbs = placeCrumbs(place);
  return (
    <div className="address-bar" role="navigation" aria-label="Address">
      <button className="crumb" onClick={() => onNavigate(HOME)}>
        Home
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
