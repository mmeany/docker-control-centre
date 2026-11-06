// Logs for one container, or several merged in time order (a compose
// project, each line marked with its service): live tail, search,
// timestamps, ranges, export.
import { useEffect, useMemo, useRef, useState } from "react";
import { appApi } from "../../api/app";
import type { AppError } from "../../api/core";
import { composeApi } from "../../api/compose";
import type { ContainerItem } from "../../api/engine";
import { streamsApi, type LogLine } from "../../api/streams";
import type { Shell } from "../../shell/shell";
import { colourOf } from "../compose/projects";
import { appendLines, findMatches, highlight, mergeByTime, rangeQuery, RANGES, shortTime, type RangeId } from "./streamUtils";

/** Must match .log-line height in styles.css. */
const LINE_H = 18;
const OVERSCAN = 20;

/** A container to show, and the label its lines get when merged. */
export interface LogSource {
  container: ContainerItem;
  label: string;
}

type Line = LogLine & { src: number };

interface Props {
  sources: LogSource[];
  /** File name (without .log) offered when exporting. */
  exportName: string;
  shell: Shell;
  /** Pops this view out into its own window (absent when already popped out). */
  onPopOut?: () => void;
}

export function LogsView({ sources, exportName, shell, onPopOut }: Props) {
  const merged = sources.length > 1;
  const [range, setRange] = useState<RangeId>("tail");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [lines, setLines] = useState<Line[]>([]);
  const [dropped, setDropped] = useState(0);
  const [ended, setEnded] = useState<{ error: string | null } | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [timestamps, setTimestamps] = useState(false);
  const [follow, setFollow] = useState(true);
  const [search, setSearch] = useState("");
  const [current, setCurrent] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(400);
  const body = useRef<HTMLDivElement>(null);
  const pending = useRef<Line[]>([]);

  const isUp = (c: ContainerItem) => c.state === "running" || c.state === "paused" || c.state === "restarting";
  const running = sources.some((s) => isUp(s.container));
  // Restart the streams when the set of containers or their running state changes.
  const sourceKey = sources.map((s) => `${s.container.id}:${isUp(s.container)}`).join(",");
  const query = useMemo(() => rangeQuery(range, Math.floor(Date.now() / 1000), custom), [range, custom]);

  // (Re)start the stream when the range changes or the container starts again.
  useEffect(() => {
    if (range === "custom" && !custom.from) {
      setLines([]);
      return;
    }
    const streams: number[] = [];
    let live = true;
    let endedCount = 0;
    let frame = 0;
    setLines([]);
    setDropped(0);
    setEnded(null);
    setError(null);
    pending.current = [];
    // Batches arrive fast; render at most once per frame.
    const flush = () => {
      frame = 0;
      const more = pending.current;
      pending.current = [];
      setLines((old) => {
        const r = appendLines(merged ? [] : old, merged ? mergeByTime(old, more) : more);
        if (r.dropped) setDropped((d) => d + r.dropped);
        return r.lines as Line[];
      });
    };
    sources.forEach((s, src) => {
      streamsApi
        .logs(s.container.id, query, (m) => {
          if (!live) return;
          if (m.type === "lines") {
            for (const l of m.lines) pending.current.push({ ...l, src });
            if (!frame) frame = requestAnimationFrame(flush);
          } else if (m.error) setEnded({ error: merged ? `${s.label}: ${m.error}` : m.error });
          else if (++endedCount === sources.length) setEnded({ error: null });
        })
        .then((id) => {
          if (live) streams.push(id);
          else void streamsApi.stop(id).catch(() => {});
        })
        .catch((e) => live && setError(e as AppError));
    });
    return () => {
      live = false;
      if (frame) cancelAnimationFrame(frame);
      for (const id of streams) void streamsApi.stop(id).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, query, range, custom.from]);

  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Follow: stay at the bottom as lines arrive.
  useEffect(() => {
    if (follow && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [lines, follow]);

  const matches = useMemo(() => findMatches(lines, search), [lines, search]);
  useEffect(() => setCurrent(0), [search]);

  function jump(step: 1 | -1) {
    if (matches.length === 0) return;
    const next = (current + step + matches.length) % matches.length;
    setCurrent(next);
    setFollow(false);
    const el = body.current;
    if (el) el.scrollTop = Math.max(0, matches[next] * LINE_H - el.clientHeight / 2);
  }

  async function exportLogs() {
    try {
      // Container and project names are [a-zA-Z0-9_.-]: already safe as file names.
      const path = await appApi.pickSaveFile("Save logs", `${exportName}.log`);
      if (!path) return;
      shell.setWorking("Saving logs…");
      let n: number;
      if (merged) {
        // What's on screen, merged, written as shown.
        const text = lines.map((l) => `${timestamps && l.time ? `${l.time} ` : ""}${sources[l.src].label} | ${l.text}\n`).join("");
        await composeApi.saveText(path, text);
        n = lines.length;
      } else n = await streamsApi.exportLogs(sources[0].container.id, query, timestamps, path);
      shell.showFlash(`Saved ${n.toLocaleString()} lines to ${path}`);
    } catch (e) {
      shell.showError(e);
    } finally {
      shell.setWorking(null);
    }
  }

  const first = Math.max(0, Math.floor(scrollTop / LINE_H) - OVERSCAN);
  const last = Math.min(lines.length, Math.ceil((scrollTop + viewH) / LINE_H) + OVERSCAN);
  const hit = matches.length ? matches[current] : -1;

  let note = "";
  if (error) note = error.message;
  else if (ended?.error) note = ended.error;
  else if (range === "custom" && !custom.from) note = "Choose when the range starts.";
  else if (ended && query.follow && !running)
    note = merged ? "None of these containers is running. New lines appear when they start." : "The container isn't running. New lines appear when it starts.";
  else if (ended && !query.follow) note = "End of the range.";

  return (
    <div className="section-pane logs-view">
      <div className="filter-bar logs-bar">
        <select className="select" value={range} onChange={(e) => setRange(e.target.value as RangeId)} aria-label="Range">
          {RANGES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        {range === "custom" && (
          <>
            <input type="datetime-local" className="text-input" aria-label="From" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            <span className="field-label">to</span>
            <input type="datetime-local" className="text-input" aria-label="To" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </>
        )}
        <input
          className="text-input logs-search"
          placeholder="Find (Enter: next, Shift+Enter: previous)"
          aria-label="Find in logs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") jump(e.shiftKey ? -1 : 1);
            else if (e.key === "Escape") setSearch("");
          }}
        />
        {search && <span className="field-label">{matches.length ? `${current + 1} of ${matches.length.toLocaleString()}` : "No matches"}</span>}
        <label className="check-row">
          <input type="checkbox" checked={timestamps} onChange={(e) => setTimestamps(e.target.checked)} /> Timestamps
        </label>
        <label className="check-row">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow
        </label>
        <div className="spacer" />
        <button className="btn" onClick={() => void exportLogs()} title={merged ? "Save the lines shown to a file" : "Save this range to a file"}>
          Export…
        </button>
        {onPopOut && (
          <button className="btn" onClick={onPopOut} title="Open the logs in their own window">
            Pop out
          </button>
        )}
      </div>
      {dropped > 0 && <div className="warn-note logs-note">Showing the last {lines.length.toLocaleString()} lines; {dropped.toLocaleString()} older lines were dropped.</div>}
      <div
        className="logs-body"
        ref={body}
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          setScrollTop(el.scrollTop);
          // Scrolling up pauses following; back at the bottom resumes it.
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < LINE_H;
          if (atBottom !== follow) setFollow(atBottom);
        }}
      >
        <div style={{ height: lines.length * LINE_H, position: "relative" }}>
          {lines.slice(first, last).map((l, i) => {
            const n = first + i;
            return (
              <div key={n} className={`log-line ${l.err ? "err" : ""} ${n === hit ? "current" : ""}`} style={{ top: n * LINE_H }}>
                {timestamps && <span className="log-time">{shortTime(l.time)}</span>}
                {merged && <span className={`log-src svc-${colourOf(sources[l.src].label)}`}>{sources[l.src].label}</span>}
                {highlight(l.text, search).map((p, j) => (p.hit ? <mark key={j}>{p.text}</mark> : <span key={j}>{p.text}</span>))}
              </div>
            );
          })}
        </div>
        {lines.length === 0 && !note && <div className="empty-note">No log lines yet.</div>}
      </div>
      {note && <div className="logs-footer">{note}</div>}
    </div>
  );
}
