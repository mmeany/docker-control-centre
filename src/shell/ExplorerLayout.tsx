// The Explorer layout: toolbar (tabs, command bar, address bar), the tree on
// the left with its Show control, the main panel, the details pane and the
// status bar. Home is a list of the sections. A pop-out window shows only the
// main panel and the status bar.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileList, type Column, type Row } from "../components/FileList";
import { HelpButton } from "../components/HelpDialog";
import { ServerIcon } from "../components/Icons";
import { attentionText } from "../components/SectionBadge";
import { StatusBar } from "../components/StatusBar";
import { StatusMark, statusTip } from "../components/StatusMark";
import { Toolbar, type TabInfo } from "../components/Toolbar";
import { TreeRow } from "../components/TreeRow";
import { SECTIONS } from "../sections";
import { TREE_LEVELS, type TreeLevel } from "../status/filter";
import { HOME, parentPlace, placeCrumbs, placeUri, rootOf, sectionOf } from "./places";
import type { AppShell } from "./useAppShell";

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
  { id: "attention", label: "Needs attention", width: 200 },
  { id: "desc", label: "Description", width: 460 },
];

export function ExplorerLayout({ app }: { app: AppShell }) {
  const { nav, place, sectionUis, active, view, homeLabel, engine } = app;
  const [treeWidth, setTreeWidth] = useState(loadTreeWidth);
  const [homeSelected, setHomeSelected] = useState<Set<string>>(new Set());
  const treeRef = useRef<HTMLDivElement>(null);

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
      columnsKey="home"
      columns={HOME_COLUMNS}
      rows={homeRows}
      selected={homeSelected}
      onSelectionChange={setHomeSelected}
      onOpen={(id) => nav.navigate(rootOf(SECTIONS.find((s) => s.id === id)!))}
      emptyText="No sections"
      view={view}
    />
  );

  const statusBar = (
    <StatusBar left={app.statusLeft} right={app.connection} rightTitle={app.connectionTitle} end={app.popout ? <HelpButton onClick={app.showHelp} /> : undefined} />
  );

  if (app.popout) {
    return (
      <div className="app popout">
        <div className="panes">
          <div className="pane-main">{content}</div>
        </div>
        {statusBar}
        {app.overlays}
      </div>
    );
  }

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

  return (
    <div className="app">
      <Toolbar
        tabs={tabInfos}
        activeTab={nav.active}
        onSelectTab={nav.selectTab}
        onCloseTab={nav.closeTab}
        onNewTab={() => nav.openTab(place)}
        homeLabel={homeLabel}
        editToken={app.editAddress}
        onSubmitAddress={app.submitAddress}
        busy={app.busy}
        theme={app.themePref}
        onThemeChange={app.changeTheme}
        onOpenSettings={app.openSettings}
        onSwitchLayout={() => app.changeLayout("dashboard")}
        onOpenHelp={app.openHelp}
        onShowHelp={app.showHelp}
        place={place}
        canBack={nav.canBack}
        canForward={nav.canForward}
        canUp={parentPlace(place) !== null}
        commands={active?.commands}
        view={view}
        onViewChange={app.changeView}
        detailsPane={app.detailsPane}
        onToggleDetailsPane={app.toggleDetailsPane}
        uri={placeUri(place)}
        onRefresh={app.refresh}
        onCopyLocation={() => void app.copyText(placeUri(place))}
        onBack={nav.back}
        onForward={nav.forward}
        onUp={app.goUp}
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
              value={app.treeLevel}
              title={TREE_LEVELS.find((l) => l.id === app.treeLevel)?.title}
              onChange={(e) => app.changeTreeLevel(e.target.value as TreeLevel)}
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
        {app.detailsPane && (
          <aside className="pane-details" aria-label="Details">
            {active?.details ?? <div className="empty-note">Select an item to see its details.</div>}
          </aside>
        )}
      </div>
      {statusBar}
      {app.overlays}
    </div>
  );
}
