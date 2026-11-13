// Confirms a dropped compose project before it starts: which files go in as
// -f (in list order), the project name compose gives them, and a warning
// when that project already exists.
import { useEffect, useState } from "react";
import { composeApi, type DropGroup } from "../../api/compose";
import type { AppError } from "../../api/core";
import { fileName, projectState, type Project } from "./projects";
import { DialogHelp } from "../../components/HelpDialog";

const ROLE: Record<DropGroup["candidates"][number]["role"], string> = {
  base: "Compose file",
  override: "Override",
  variant: "Variant",
};

interface Props {
  group: DropGroup;
  /** 1-based position when several folders were dropped. */
  index: number;
  count: number;
  /** Why some dropped folders were left out (shown here, not in a second dialog). */
  skipped: string[];
  /** Projects the app already knows, by name. */
  projects: Map<string, Project>;
  /** Engine or Windows path, as shown to the user. */
  shown: (path: string) => string;
  onStart: (files: string[]) => void;
  onCancel: () => void;
}

export function DropComposeDialog({ group, index, count, skipped, projects, shown, onStart, onCancel }: Props) {
  const [ticked, setTicked] = useState(() => group.candidates.map((c) => c.ticked));
  const files = group.candidates.filter((_, i) => ticked[i]).map((c) => c.path);
  const key = files.join("\n");
  const [name, setName] = useState<{ key: string; name: string | null; error: string | null } | null>(null);

  // Compose names the project (and checks the files read) as the ticks change.
  useEffect(() => {
    if (!key) return;
    let stale = false;
    const t = window.setTimeout(() => {
      composeApi
        .projectName(key.split("\n"))
        .then((n) => !stale && setName({ key, name: n, error: null }))
        .catch((e) => !stale && setName({ key, name: null, error: (e as AppError).message }));
    }, 200);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [key]);

  const current = name && name.key === key ? name : null;
  const existing = current?.name ? projects.get(current.name) : undefined;
  const samePin = existing?.pinned && existing.pinned.files.join("\n") === key;
  const ready = files.length > 0 && current?.name;

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog dialog-wide drop-dialog"
        role="dialog"
        aria-modal
        aria-labelledby="drop-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      >
        <div className="dialog-title" id="drop-title">
          Start a compose project{count > 1 ? ` (${index} of ${count})` : ""}
          <DialogHelp topic="compose.drop" />
        </div>
        <div className="dialog-body">
          {skipped.map((s) => (
            <p key={s} className="warn-note drop-skipped">
              Skipped: {s}
            </p>
          ))}
          <p>
            From <span className="mono">{shown(group.dir)}</span>. Ticked files are passed to compose in this order, then it runs{" "}
            <span className="mono">up -d</span> and the project is pinned.
          </p>
          <table className="data-table drop-files">
            <tbody>
              {group.candidates.map((c, i) => (
                <tr key={c.path}>
                  <td className="drop-tick">
                    <input
                      type="checkbox"
                      id={`drop-file-${i}`}
                      checked={ticked[i]}
                      onChange={() => setTicked((t) => t.map((v, j) => (j === i ? !v : v)))}
                    />
                  </td>
                  <td>
                    <label htmlFor={`drop-file-${i}`} className="mono">
                      {fileName(c.path)}
                    </label>
                  </td>
                  <td className="hint">{ROLE[c.role]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {files.length === 0 ? (
            <p className="warn-note">Tick at least one file.</p>
          ) : !current ? (
            <p className="hint">Reading the compose files…</p>
          ) : current.error ? (
            <p className="warn-note">{current.error}</p>
          ) : (
            <>
              <p>
                Project: <strong>{current.name}</strong>
              </p>
              {existing && existing.containers.length > 0 && (
                <p className="warn-note">
                  {existing.name} already exists ({projectState(existing).toLowerCase()}) from <span className="mono">{shown(existing.dir)}</span>. Up recreates what changed.
                </p>
              )}
              {existing?.pinned && !samePin && (
                <p className="warn-note">
                  {existing.name} is pinned from {existing.pinned.files.map(fileName).join(", ")}. Starting it from these files replaces that pin.
                </p>
              )}
            </>
          )}
        </div>
        <div className="dialog-buttons">
          <div className="spacer" />
          <button className="btn primary" disabled={!ready} onClick={() => onStart(files)}>
            Start
          </button>
          <button className="btn" onClick={onCancel} autoFocus>
            {count > index ? "Skip" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
