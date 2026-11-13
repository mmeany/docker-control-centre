// The dashboard layout: a collapsible side nav (Overview, the sections with
// their badges, Help / Settings / Theme), a header (back / forward / up, the
// place as a breadcrumb title, refresh, copy address, details, switch to
// Explorer), the section's commands, the content and a details drawer, then
// the status bar. Places, history and tabs are the shell's as in Explorer;
// only the active tab is shown. A section shows its `board` if it has one,
// else its Explorer content.
import { useState, type ReactNode } from "react";
import type { ThemePref } from "../api/core";
import { CommandSeparator } from "../components/CommandButton";
import { HelpButton } from "../components/HelpDialog";
import { BackIcon, CopyIcon, ExplorerIcon, ForwardIcon, GearIcon, HomeIcon, RefreshIcon, SidebarIcon, UpIcon } from "../components/Icons";
import { attentionText, SectionBadge } from "../components/SectionBadge";
import { StatusBar } from "../components/StatusBar";
import { Overview } from "../dashboard/Overview";
import { SECTIONS } from "../sections";
import { HOME, parentPlace, placeCrumbs, placeUri, rootOf } from "./places";
import type { AppShell } from "./useAppShell";

const NAV_COLLAPSED_KEY = "app.dashNavCollapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function DashboardLayout({ app }: { app: AppShell }) {
  const { nav, place, sectionUis, active, homeLabel, engine } = app;
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  function toggleCollapsed() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, c ? "0" : "1");
      } catch {
        /* storage unavailable: the choice just isn't remembered */
      }
      return !c;
    });
  }

  const crumbs = placeCrumbs(place);
  const title = crumbs.length ? crumbs[crumbs.length - 1].label : "Overview";
  const uri = placeUri(place);

  const content: ReactNode = active ? (active.board ?? active.content) : <Overview app={app} />;

  return (
    <div className="app dash">
      <div className="dash-body">
        <nav className={`dash-nav ${collapsed ? "collapsed" : ""}`} aria-label="Sections">
          <div className="dash-nav-head">
            <button className="tool-btn" title={collapsed ? "Show the side panel" : "Hide the side panel"} aria-expanded={!collapsed} onClick={toggleCollapsed}>
              <SidebarIcon />
            </button>
            {!collapsed && (
              <div className="dash-engine" title={engine.info?.endpoint}>
                <strong>{homeLabel}</strong>
                <span>{engine.info ? `Docker ${engine.info.serverVersion}` : engine.status === "connecting" ? "Connecting…" : "Not connected"}</span>
              </div>
            )}
          </div>
          <NavItem label="Overview" icon={<HomeIcon size={18} />} active={place.section === null} collapsed={collapsed} onClick={() => nav.navigate(HOME)} />
          {SECTIONS.map((s) => {
            const a = sectionUis[s.id].attention ?? { errors: 0, orphans: 0 };
            const text = attentionText(a);
            return (
              <NavItem
                key={s.id}
                label={s.name}
                title={text ? `${s.name}: ${text}` : s.description}
                icon={s.icon}
                active={place.section === s.id}
                collapsed={collapsed}
                badge={<SectionBadge {...a} />}
                onClick={() => nav.navigate(rootOf(s))}
              />
            );
          })}
          <div className="dash-nav-foot">
            <NavItem
              label="Help"
              title="Help: this view, general help, what the colours mean, about this app"
              icon={<span className="dash-help-mark">?</span>}
              collapsed={collapsed}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                app.openHelp(r.right, r.top);
              }}
            />
            <NavItem label="Settings" title="Settings: layout, where compose runs" icon={<GearIcon size={18} />} collapsed={collapsed} onClick={app.openSettings} />
            {!collapsed && (
              <div className="dash-theme">
                <label className="field-label" htmlFor="theme">
                  Theme:
                </label>
                <select
                  id="theme"
                  className="select theme-select"
                  value={app.themePref}
                  onChange={(e) => app.changeTheme(e.target.value as ThemePref)}
                  title="System follows your OS setting (dark if it can't be detected)"
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
            )}
          </div>
        </nav>

        <div className="dash-main">
          <header className="dash-header">
            <button className="tool-btn" title="Back (Alt+Left)" onClick={nav.back} disabled={!nav.canBack}>
              <BackIcon />
            </button>
            <button className="tool-btn" title="Forward (Alt+Right)" onClick={nav.forward} disabled={!nav.canForward}>
              <ForwardIcon />
            </button>
            <button className="tool-btn" title="Up one level (Backspace)" onClick={app.goUp} disabled={parentPlace(place) === null}>
              <UpIcon />
            </button>
            <div className="dash-crumbs" role="navigation" aria-label="Location">
              {crumbs.length > 0 && (
                <button className="dash-crumb" onClick={() => nav.navigate(HOME)}>
                  Overview
                </button>
              )}
              {crumbs.slice(0, -1).map((c, i) => (
                <span key={i} className="crumb-wrap">
                  <span className="crumb-sep">›</span>
                  <button className="dash-crumb" onClick={() => nav.navigate(c.place)}>
                    {c.label}
                  </button>
                </span>
              ))}
              {crumbs.length > 0 && <span className="crumb-sep">›</span>}
              <h1 className="dash-title" title={uri}>
                {title}
              </h1>
            </div>
            <div className="spacer" />
            {app.busy && <span className="busy">Working…</span>}
            <button className="tool-btn" title={`Copy ${uri} to the clipboard`} onClick={() => void app.copyText(uri)}>
              <CopyIcon />
            </button>
            <button className="tool-btn" title="Refresh (F5)" onClick={app.refresh}>
              <RefreshIcon />
            </button>
            {!active?.commands && <HelpButton onClick={app.showHelp} />}
            <button
              className={`cmd-btn ${app.detailsPane ? "pressed" : ""}`}
              aria-pressed={app.detailsPane}
              title="Show or hide details (Alt+Shift+P)"
              onClick={app.toggleDetailsPane}
            >
              <span className="cmd-label">Details</span>
            </button>
            <button className="cmd-btn" title="Switch to the Explorer layout (also in Settings)" onClick={() => app.changeLayout("explorer")}>
              <ExplorerIcon /> <span className="cmd-label">Explorer</span>
            </button>
          </header>
          {active?.commands && (
            <div className="toolbar-row command-bar dash-commands">
              {active.commands}
              <CommandSeparator />
              <HelpButton onClick={app.showHelp} />
            </div>
          )}
          <div className="dash-content">
            <div className="pane-main">{content}</div>
            {app.detailsPane && (
              <aside className="pane-details dash-drawer" aria-label="Details">
                {active?.details ?? <div className="empty-note">Select an item to see its details.</div>}
              </aside>
            )}
          </div>
        </div>
      </div>
      <StatusBar left={app.statusLeft} right={app.connection} rightTitle={app.connectionTitle} />
      {app.overlays}
    </div>
  );
}

interface NavItemProps {
  label: string;
  title?: string;
  icon: ReactNode;
  active?: boolean;
  collapsed: boolean;
  badge?: ReactNode;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

function NavItem({ label, title, icon, active, collapsed, badge, onClick }: NavItemProps) {
  return (
    <button className={`dash-nav-item ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} title={collapsed ? (title ?? label) : title} onClick={onClick}>
      <span className="dash-nav-icon">{icon}</span>
      {!collapsed && <span className="dash-nav-label">{label}</span>}
      {!collapsed && badge}
    </button>
  );
}
