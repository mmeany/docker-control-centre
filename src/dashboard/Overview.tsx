// The dashboard's Home: engine-wide totals with five-minute sparklines, the
// top containers by CPU and memory, what needs attention (with quick
// actions), and the Compose projects. The totals stream runs only while this
// is on screen.
import type { ReactNode } from "react";
import type { ContainerItem } from "../api/engine";
import type { ContainerFigures } from "../api/streams";
import { StatusMark } from "../components/StatusMark";
import { formatSize } from "../format";
import { SECTIONS } from "../sections";
import { projectsFrom, projectState } from "../sections/compose/projects";
import { VERBS } from "../sections/containers/actions";
import { containerPath } from "../sections/containers/paths";
import { sparkline } from "../sections/containers/streamUtils";
import { rootOf, type Place } from "../shell/places";
import type { AppShell } from "../shell/useAppShell";
import { projectStatus } from "../status/status";
import { countedText, cpuShare, problemContainers, topBy, type TotalsPoint } from "./overviewData";
import { useTotals } from "./useTotals";

const W = 300;
const H = 44;
const perSecond = (n: number) => `${formatSize(Math.round(n))}/s`;

function Tile({ title, value, sub, series, floor }: { title: string; value: string; sub: string; series: number[]; floor: number }) {
  return (
    <div className="ov-tile">
      <div className="ov-tile-title">{title}</div>
      <div className="ov-tile-value">{value}</div>
      <div className="ov-tile-sub">{sub}</div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="sparkline" aria-hidden>
        <polyline points={sparkline(series, W, H, floor)} />
      </svg>
    </div>
  );
}

function Panel({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`ov-panel ${wide ? "wide" : ""}`}>
      <h2 className="ov-panel-title">{title}</h2>
      {children}
    </section>
  );
}

export function Overview({ app }: { app: AppShell }) {
  const totals = useTotals(app.engine);
  const containers = app.containers.items ?? [];
  const byId = new Map(containers.map((c) => [c.id, c]));
  const go = (p: Place) => app.nav.navigate(p);
  const openContainer = (c: ContainerItem, child = "") => go({ section: "containers", path: containerPath(c.project, c.name) + (child ? `/${child}` : "") });

  const s = totals.latest;
  const h = totals.history;
  const series = (k: keyof TotalsPoint) => h.map((p) => p[k]);

  return (
    <div className="dash-home overview">
      <div className="ov-caption">
        <span>{countedText(s)}</span>
        {s && s.skipped > 0 && <span className="badge-warn">Capped at {s.counted.toLocaleString()}</span>}
        {totals.error && <span className="warn-note ov-error">{totals.error}</span>}
      </div>
      <div className="ov-tiles">
        <Tile
          title="CPU"
          value={s ? `${cpuShare(s).toFixed(1)}%` : "–"}
          sub={s ? `of ${s.onlineCpus} CPU${s.onlineCpus === 1 ? "" : "s"} (${s.cpuPercent.toFixed(0)}% of one)` : "of the engine"}
          series={series("cpu")}
          floor={10}
        />
        <Tile
          title="Memory"
          value={s ? formatSize(s.memUsed) : "–"}
          sub={s && s.memLimit ? `${((s.memUsed / s.memLimit) * 100).toFixed(1)}% of ${formatSize(s.memLimit)}` : "used by containers"}
          series={series("mem")}
          floor={s?.memLimit || 1}
        />
        <Tile title="Network" value={s ? `${perSecond(s.netRxRate)} in` : "–"} sub={s ? `${perSecond(s.netTxRate)} out` : "in and out"} series={series("netRx")} floor={1024} />
        <Tile title="Disk" value={s ? `${perSecond(s.blockWriteRate)} written` : "–"} sub={s ? `${perSecond(s.blockReadRate)} read` : "read and written"} series={series("blockWrite")} floor={1024} />
      </div>

      <div className="ov-panels">
        <Panel title="Top CPU">
          <TopList list={s ? topBy(s.containers, "cpuPercent") : []} value={(c) => `${c.cpuPercent.toFixed(1)}%`} amount={(c) => c.cpuPercent} byId={byId} onOpen={(c) => openContainer(c, "stats")} />
        </Panel>
        <Panel title="Top memory">
          <TopList list={s ? topBy(s.containers, "memUsed") : []} value={(c) => formatSize(c.memUsed)} amount={(c) => c.memUsed} byId={byId} onOpen={(c) => openContainer(c, "stats")} />
        </Panel>
        <Panel title="Needs attention" wide>
          <Attention app={app} openContainer={openContainer} />
        </Panel>
        <Panel title="Compose projects" wide>
          <Projects app={app} />
        </Panel>
      </div>
    </div>
  );
}

interface TopProps {
  list: ContainerFigures[];
  value: (c: ContainerFigures) => string;
  amount: (c: ContainerFigures) => number;
  byId: Map<string, ContainerItem>;
  onOpen: (c: ContainerItem) => void;
}

function TopList({ list, value, amount, byId, onOpen }: TopProps) {
  if (list.length === 0) return <div className="empty-note">Nothing running is using any.</div>;
  const max = Math.max(...list.map(amount));
  return (
    <ol className="ov-top">
      {list.map((f) => {
        const c = byId.get(f.id);
        return (
          <li key={f.id}>
            <button className="ov-link" disabled={!c} onClick={() => c && onOpen(c)} title={c ? `Open ${f.name}'s stats` : f.name}>
              {f.name}
            </button>
            <span className="ov-bar" aria-hidden>
              <span style={{ width: `${max > 0 ? (amount(f) / max) * 100 : 0}%` }} />
            </span>
            <span className="ov-num">{value(f)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Attention({ app, openContainer }: { app: AppShell; openContainer: (c: ContainerItem, child?: string) => void }) {
  const problems = problemContainers(app.containers.items ?? []);
  const orphans = SECTIONS.map((s) => ({ s, n: app.sectionUis[s.id].attention?.orphans ?? 0 })).filter((x) => x.n > 0);
  const act = app.sectionUis.containers?.act;
  if (problems.length === 0 && orphans.length === 0) return <div className="ok-note">Nothing needs attention.</div>;
  return (
    <ul className="ov-rows">
      {problems.map(({ container: c, status }) => (
        <li key={c.id} className="ov-row">
          <StatusMark status={status} />
          <button className="ov-link" onClick={() => openContainer(c)} title={status.reason}>
            {c.name}
          </button>
          <span className="ov-row-note" title={status.reason}>
            {status.label} · {status.reason}
          </span>
          <span className="ov-row-actions">
            {act && VERBS.restart.applies(c.state) && (
              <button className="btn" onClick={() => act(c.id, "restart")}>
                Restart
              </button>
            )}
            <button className="btn" onClick={() => openContainer(c, "logs")}>
              Logs
            </button>
          </span>
        </li>
      ))}
      {orphans.map(({ s, n }) => (
        <li key={s.id} className="ov-row">
          <StatusMark status={{ state: "orphaned", label: "Orphaned", reason: "" }} />
          <button className="ov-link" onClick={() => app.nav.navigate(rootOf(s))}>
            {s.name}
          </button>
          <span className="ov-row-note">{n.toLocaleString()} orphaned: nothing uses them, safe to prune</span>
          <span className="ov-row-actions">
            <button className="btn" onClick={() => app.nav.navigate(rootOf(s))} title={`Open ${s.name} to review and prune`}>
              Review
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Projects({ app }: { app: AppShell }) {
  const compose = app.sectionUis.compose;
  const projects = projectsFrom(app.containers.items ?? [], app.composePinned);
  if (projects.length === 0) return <div className="empty-note">No compose projects. Pin a compose file in Compose to see one here.</div>;
  return (
    <div className="ov-projects">
      {projects.map((p) => {
        const st = projectStatus(p.containers, p.pinned !== null);
        const open = () => app.nav.navigate({ section: "compose", path: p.name });
        return (
          <div key={p.name} className="ov-project">
            <button className="ov-project-head" onClick={open} title={st.reason}>
              <StatusMark status={st} />
              <span className="ov-project-name">{p.name}</span>
            </button>
            <div className="ov-project-state">
              {projectState(p)}
              {p.containers.length > 0 && ` · ${p.containers.length} container${p.containers.length === 1 ? "" : "s"}`}
            </div>
            <div className="ov-row-actions">
              {compose?.act && (p.containers.length === 0 || p.running < p.containers.length) && (
                <button className="btn" onClick={() => compose.act?.(p.name, "up")}>
                  Up
                </button>
              )}
              {compose?.act && p.running > 0 && (
                <button className="btn" onClick={() => compose.act?.(p.name, "stop")}>
                  Stop
                </button>
              )}
              <button className="btn" onClick={open}>
                Open
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
