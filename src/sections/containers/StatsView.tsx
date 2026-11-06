// Live CPU, memory, network, disk and process counts, with two-minute sparklines.
import { useEffect, useState } from "react";
import type { AppError } from "../../api/core";
import type { ContainerItem } from "../../api/engine";
import { streamsApi, type StatsSample } from "../../api/streams";
import { formatSize } from "../../format";
import { rates, sparkline, type Rates } from "./streamUtils";

/** About two minutes at one sample a second. */
const KEEP = 120;
const W = 220;
const H = 44;

interface Props {
  container: ContainerItem;
  onPopOut?: () => void;
}

const perSecond = (n: number) => `${formatSize(Math.round(n))}/s`;

function Tile({ title, value, sub, series, floor }: { title: string; value: string; sub?: string; series: number[]; floor?: number }) {
  return (
    <div className="stat-tile stats-tile">
      <div className="st-label">{title}</div>
      <div className="st-num">{value}</div>
      {sub && <div className="st-sub">{sub}</div>}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="sparkline" aria-hidden>
        <polyline points={sparkline(series, W, H, floor)} />
      </svg>
    </div>
  );
}

export function StatsView({ container, onPopOut }: Props) {
  const [samples, setSamples] = useState<StatsSample[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const running = container.state === "running" || container.state === "paused";

  useEffect(() => {
    if (!running) return;
    let stream: number | null = null;
    let live = true;
    setSamples([]);
    setError(null);
    streamsApi
      .stats(container.id, (s) => live && setSamples((old) => [...old.slice(-(KEEP - 1)), s]))
      .then((id) => {
        if (live) stream = id;
        else void streamsApi.stop(id).catch(() => {});
      })
      .catch((e) => live && setError(e as AppError));
    return () => {
      live = false;
      if (stream !== null) void streamsApi.stop(stream).catch(() => {});
    };
  }, [container.id, running]);

  if (!running) return <div className="empty-note center">{container.name} isn't running. Stats appear while it runs.</div>;
  if (error) return <div className="empty-note center">{error.message}</div>;
  const now = samples[samples.length - 1];
  if (!now) return <div className="empty-note">Waiting for the first sample…</div>;

  const r: Rates[] = samples.slice(1).map((s, i) => rates(samples[i], s));
  const rNow = r[r.length - 1] ?? { netRx: 0, netTx: 0, blockRead: 0, blockWrite: 0 };
  const memPct = now.memLimit ? (now.memUsed / now.memLimit) * 100 : 0;

  return (
    <div className="section-pane">
      <div className="filter-bar">
        <span className="field-label">Live, last two minutes</span>
        <div className="spacer" />
        {onPopOut && (
          <button className="btn" onClick={onPopOut} title="Open the stats in their own window">
            Pop out
          </button>
        )}
      </div>
      <div className="detail-view">
        <div className="stat-tiles stats-grid">
          <Tile
            title="CPU"
            value={`${now.cpuPercent.toFixed(1)}%`}
            sub={`of ${now.onlineCpus} CPU${now.onlineCpus === 1 ? "" : "s"} (${(now.onlineCpus * 100).toLocaleString()}% is all of them)`}
            series={samples.map((s) => s.cpuPercent)}
            floor={10}
          />
          <Tile
            title="Memory"
            value={formatSize(now.memUsed)}
            sub={now.memLimit ? `${memPct.toFixed(1)}% of ${formatSize(now.memLimit)}` : undefined}
            series={samples.map((s) => s.memUsed)}
          />
          <Tile title="Network in" value={perSecond(rNow.netRx)} sub={`${formatSize(now.netRx)} in total`} series={r.map((x) => x.netRx)} floor={1024} />
          <Tile title="Network out" value={perSecond(rNow.netTx)} sub={`${formatSize(now.netTx)} in total`} series={r.map((x) => x.netTx)} floor={1024} />
          <Tile title="Disk read" value={perSecond(rNow.blockRead)} sub={`${formatSize(now.blockRead)} in total`} series={r.map((x) => x.blockRead)} floor={1024} />
          <Tile title="Disk write" value={perSecond(rNow.blockWrite)} sub={`${formatSize(now.blockWrite)} in total`} series={r.map((x) => x.blockWrite)} floor={1024} />
          <Tile title="Processes" value={now.pids.toLocaleString()} series={samples.map((s) => s.pids)} floor={1} />
        </div>
      </div>
    </div>
  );
}
