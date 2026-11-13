// A project's unnamed volumes (/compose/<project>/volumes): what compose's
// config, the images' VOLUMEs and the containers say, loaded from Rust and
// reloaded when containers or volumes change. The section builds the list
// (Explorer) and board (dashboard) from the same rows.
import { useCallback, useEffect, useState } from "react";
import type { AppError } from "../../api/core";
import { composeApi, type ComposeTarget, type UnnamedVolume, type UnnamedVolumes } from "../../api/compose";
import type { Column, Row } from "../../components/FileList";
import { VolumeIcon } from "../../components/Icons";
import type { EngineState } from "../../state/engine";
import { CAUSE_NOTE, CAUSE_TEXT, shortHash } from "../volumes/anonymous";

export const UNNAMED_COLUMNS: Column[] = [
  { id: "target", label: "Path in container", width: 260 },
  { id: "service", label: "Service", width: 120 },
  { id: "cause", label: "Why it's unnamed", width: 170 },
  { id: "current", label: "Volume now", width: 260 },
  { id: "name", label: "Proposed name", width: 200 },
];

/** A row's key: service and path. */
export const unnamedKey = (f: UnnamedVolume) => `${f.service}:${f.target}`;

export interface UnnamedState {
  /** null until the first load; always for `target` (never another project's). */
  data: UnnamedVolumes | null;
  error: AppError | null;
  loading: boolean;
  refresh: () => void;
}

/** Loads while `target` is set (the volumes view is open); null clears it. */
export function useUnnamedVolumes(engine: EngineState, target: ComposeTarget | null): UnnamedState {
  const [state, setState] = useState<{ key: string; data: UnnamedVolumes | null; error: AppError | null }>({ key: "", data: null, error: null });
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);
  const connected = engine.status === "connected";
  const key = target ? JSON.stringify(target) : "";

  useEffect(() => {
    if (!target || !connected) return;
    let stale = false;
    setLoading(true);
    composeApi
      .unnamedVolumes(target)
      .then((data) => !stale && setState({ key, data, error: null }))
      .catch((e) => !stale && setState({ key, data: null, error: e as AppError }))
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
    // `target` is keyed by its JSON.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, connected, engine.changes.container, engine.changes.volume, token]);

  const refresh = useCallback(() => setToken((t) => t + 1), []);
  const mine = state.key === key && key !== "";
  return { data: mine ? state.data : null, error: mine ? state.error : null, loading, refresh };
}

export function unnamedRows(list: UnnamedVolume[]): Row[] {
  return list.map((f) => {
    const now = f.current.map((c) => `${shortHash(c.volume)} (${c.container})`).join(", ");
    return {
      key: unnamedKey(f),
      icon: <VolumeIcon />,
      isContainer: false,
      cells: {
        target: { text: f.target, sort: f.target },
        service: { text: f.service, sort: f.service },
        cause: { text: CAUSE_TEXT[f.cause], sort: f.cause, title: CAUSE_NOTE[f.cause] },
        current: now
          ? { text: now, sort: now, title: f.current.map((c) => `${c.container}: ${c.volume}`).join("\n") }
          : { text: "None yet", sort: "", muted: true, title: "No container holds one now: Up makes it." },
        name: { text: f.name, sort: f.name },
      },
    };
  });
}

/** What couldn't be checked, above the list. */
export function UnnamedNotes({ data }: { data: UnnamedVolumes }) {
  const pull = data.unchecked.filter((u) => !u.build);
  const build = data.unchecked.filter((u) => u.build);
  const which = (l: typeof pull) => l.map((u) => `${u.service} (${u.image})`).join(", ");
  return (
    <div className="unnamed-notes">
      <p className="hint">
        Volumes Docker makes with no name, because nothing names one at that path: an image VOLUME nothing is mounted over, or a volume asked for without a name.
        They get hash names, so they're hard to find in the volumes list. The proposed names say what each would be called once named in the compose file.
      </p>
      {data.configError && <p className="warn-note">Compose couldn't read the project's files, so only volumes its containers hold now are shown. {data.configError}</p>}
      {pull.length > 0 && (
        <p className="warn-note">
          Pull to check: {which(pull)}. {pull.length === 1 ? "Its image isn't" : "Their images aren't"} on the engine, so {pull.length === 1 ? "its" : "their"} VOLUMEs
          can't be read.
        </p>
      )}
      {build.length > 0 && (
        <p className="warn-note">
          Build to check: {which(build)}. {build.length === 1 ? "It's" : "They're"} built by compose and not built yet, so the image's VOLUMEs can't be read.
        </p>
      )}
    </div>
  );
}
