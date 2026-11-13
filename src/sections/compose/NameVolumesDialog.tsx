// Names a project's unnamed volumes in its compose files: a key and name per
// volume (editable, checked in Rust against the files and the engine), the
// revised files as diffs, and Copy / Save as / Save in place (with a .bak).
// Save and move data also copies what the containers hold into the named
// volumes (the section runs it in the Run dialog).
// Anything the editor can't change safely is listed with a snippet to add
// by hand.
import { useEffect, useState } from "react";
import { appApi } from "../../api/app";
import { composeApi, type ComposeTarget, type MoveRequest, type NameRequest, type Revision, type SaveFile, type UnnamedVolume } from "../../api/compose";
import { toAppError, type AppError } from "../../api/core";
import { DiffView } from "../../components/DiffView";
import { DialogHelp } from "../../components/HelpDialog";
import type { Shell } from "../../shell/shell";
import { CAUSE_TEXT } from "../volumes/anonymous";
import { fileName } from "./projects";

interface Props {
  project: string;
  target: ComposeTarget;
  findings: UnnamedVolume[];
  /** Shows an engine-side path the way Windows names it. */
  shown: (path: string) => string;
  shell: Shell;
  /** After Save in place (the files changed). */
  onSaved: () => void;
  /** Save and move data: the section saves, stops, copies and brings it up. */
  onMove: (files: SaveFile[], moves: MoveRequest[]) => void;
  onClose: () => void;
}

type Preview = { key: string; revision: Revision | null; error: AppError | null };

export function NameVolumesDialog({ project, target, findings, shown, shell, onSaved, onMove, onClose }: Props) {
  const [rows, setRows] = useState(() => findings.map((f) => ({ on: true, key: f.key, name: f.name })));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [tab, setTab] = useState(0);
  const [saving, setSaving] = useState(false);

  const picked = rows.map((r, i) => ({ r, f: findings[i], i })).filter((x) => x.r.on);
  const requests: NameRequest[] = picked.map(({ r, f }) => ({ service: f.service, target: f.target, key: r.key.trim(), name: r.name.trim() }));
  const reqKey = JSON.stringify(requests);
  const targetKey = JSON.stringify(target);

  // Rust revises the files (and checks the names) as the rows change.
  useEffect(() => {
    let stale = false;
    const t = window.setTimeout(() => {
      composeApi
        .nameVolumes(JSON.parse(targetKey) as ComposeTarget, JSON.parse(reqKey) as NameRequest[])
        .then((revision) => !stale && setPreview({ key: reqKey, revision, error: null }))
        .catch((e) => !stale && setPreview({ key: reqKey, revision: null, error: toAppError(e) }));
    }, 250);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [reqKey, targetKey]);

  const current = preview?.key === reqKey ? preview : null;
  const rev = current?.revision ?? null;
  const changed = rev?.files.filter((f) => f.changed) ?? [];
  const file = changed[Math.min(tab, changed.length - 1)];
  // An issue's index is into the picked rows; show it on the row it's about.
  const issueOf = (row: number, field: "key" | "name") => {
    const at = picked.findIndex((p) => p.i === row);
    return at < 0 ? undefined : rev?.issues.find((x) => x.index === at && x.field === field)?.message;
  };
  const ready = !!rev && rev.issues.length === 0 && changed.length > 0 && !saving;
  // Data can move for ticked volumes a container holds now that the files name.
  const movable = rev
    ? picked.filter(({ f }) => f.current.length > 0 && !rev.manual.some((m) => m.service === f.service && m.target === f.target))
    : [];

  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function saveAs() {
    if (!file) return;
    try {
      const path = await appApi.pickSaveFile("Save the revised compose file", fileName(file.path));
      if (!path) return;
      await composeApi.saveText(path, file.revised);
      shell.showFlash(`Saved ${path}`);
    } catch (e) {
      shell.showError(e);
    }
  }

  /** Asks before replacing older .bak files; false if not. */
  async function backupsOk() {
    const old = changed.filter((f) => f.backupExists);
    if (old.length > 0) {
      const ok = await shell.ask(
        "Replace backups",
        <p>
          {old.map((f) => `${fileName(f.path)}.bak`).join(", ")} {old.length === 1 ? "is" : "are"} already there from an earlier save. Replace{" "}
          {old.length === 1 ? "it" : "them"} with a copy of the file as it is now?
        </p>,
        [{ label: "Replace and save", value: "yes", primary: true }, { label: "Cancel", value: "no" }],
        "no",
      );
      if (ok !== "yes") return false;
    }
    return true;
  }

  async function saveAndMove() {
    if (!ready || movable.length === 0 || !(await backupsOk())) return;
    const more = movable.filter(({ f }) => f.current.length > 1);
    const ok = await shell.ask(
      "Save and move data",
      <>
        <p>
          This saves the compose {changed.length === 1 ? "file" : "files"} (keeping a .bak), stops {project}, copies what{" "}
          {movable.length === 1 ? "this unnamed volume holds into its named volume" : `these ${movable.length} unnamed volumes hold into their named volumes`}, then
          brings {project} up on them.
        </p>
        {more.length > 0 && (
          <p className="warn-note">
            {more.map(({ f }) => `${f.service} ${f.target}`).join(", ")}: several containers hold their own volume there. Only {more[0].f.current[0].container}'s is copied, and the
            containers will share the named one.
          </p>
        )}
        <p>The old volumes are kept, so nothing is lost if a step fails. Prune removes them later.</p>
      </>,
      [{ label: "Save and move", value: "yes", primary: true }, { label: "Cancel", value: "no" }],
      "no",
    );
    if (ok !== "yes") return;
    onMove(
      changed.map((f) => ({ path: f.path, original: f.original, revised: f.revised, replaceBackup: f.backupExists })),
      movable.map(({ f, r }) => ({ from: f.current[0].volume, key: r.key.trim(), name: r.name.trim() })),
    );
  }

  async function saveInPlace() {
    if (!ready || !(await backupsOk())) return;
    setSaving(true);
    let saved = 0;
    try {
      for (const f of changed) {
        await composeApi.saveRevision(f.path, f.original, f.revised, f.backupExists);
        saved++;
      }
      shell.showFlash(saved === 1 ? `Saved ${fileName(changed[0].path)} (the old one is in ${fileName(changed[0].path)}.bak)` : `Saved ${saved} files (the old ones are in .bak files)`);
      onSaved();
    } catch (e) {
      if (saved > 0) shell.showFlash(`Saved ${saved} of ${changed.length} files`);
      shell.showError(e);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="dialog preview-dialog name-volumes-dialog"
        role="dialog"
        aria-modal
        aria-labelledby="name-volumes-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="dialog-title" id="name-volumes-title">
          Name volumes · {project}
          <DialogHelp topic="compose.name" />
        </div>
        <div className="dialog-body">
          <p className="hint">
            Each ticked volume gets a key under the top-level <span className="mono">volumes:</span> with a fixed <span className="mono">name:</span>, so the
            volumes list shows that name. Nothing is written until you save.
          </p>
          <table className="data-table name-volumes-rows">
            <thead>
              <tr>
                <th />
                <th>Service</th>
                <th>Path in container</th>
                <th>Why</th>
                <th>Key</th>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f, i) => {
                const keyIssue = issueOf(i, "key");
                const nameIssue = issueOf(i, "name");
                return (
                  <tr key={`${f.service}:${f.target}`}>
                    <td>
                      <input type="checkbox" aria-label={`Name ${f.target}`} checked={rows[i].on} onChange={() => set(i, { on: !rows[i].on })} />
                    </td>
                    <td>{f.service}</td>
                    <td className="mono">{f.target}</td>
                    <td className="hint">{CAUSE_TEXT[f.cause]}</td>
                    <td>
                      <input className={`text-input mono${keyIssue ? " invalid" : ""}`} aria-label={`Key for ${f.target}`} value={rows[i].key} disabled={!rows[i].on} onChange={(e) => set(i, { key: e.target.value })} />
                      {keyIssue && <div className="field-error">{keyIssue}</div>}
                    </td>
                    <td>
                      <input className={`text-input mono${nameIssue ? " invalid" : ""}`} aria-label={`Name for ${f.target}`} value={rows[i].name} disabled={!rows[i].on} onChange={(e) => set(i, { name: e.target.value })} />
                      {nameIssue && <div className="field-error">{nameIssue}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {picked.length === 0 ? (
            <p className="warn-note">Tick at least one volume.</p>
          ) : !current ? (
            <p className="hint">Revising the compose files…</p>
          ) : current.error ? (
            <p className="warn-note">{current.error.message}</p>
          ) : (
            rev && (
              <>
                {rev.manual.map((m) => (
                  <div key={`${m.service}:${m.target}`} className="warn-note name-volumes-manual">
                    <p>
                      {m.service} {m.target} has to be named by hand: {m.reason}
                    </p>
                    <pre className="mono">{m.snippet}</pre>
                    <button className="btn" onClick={() => void shell.copyText(m.snippet).then(() => shell.showFlash("Copied the snippet"))}>
                      Copy snippet
                    </button>
                  </div>
                ))}
                {changed.length === 0 ? (
                  <p className="hint">No file changes.</p>
                ) : (
                  <>
                    <div className="filter-bar name-volumes-files">
                      <div className="segmented" role="tablist" aria-label="Changed files">
                        {changed.map((f, i) => (
                          <button key={f.path} role="tab" aria-selected={f === file} className={f === file ? "active" : ""} title={shown(f.path)} onClick={() => setTab(i)}>
                            {fileName(f.path)}
                          </button>
                        ))}
                      </div>
                      <span className="mono compose-file-path" title={file.path}>
                        {file.path}
                      </span>
                    </div>
                    <DiffView before={file.original} after={file.revised} beforeLabel={fileName(file.path)} afterLabel="Revised" />
                  </>
                )}
              </>
            )
          )}
        </div>
        <div className="dialog-buttons">
          <button className="btn" disabled={!file} onClick={() => file && void shell.copyText(file.revised).then(() => shell.showFlash(`Copied the revised ${fileName(file.path)}`))}>
            Copy
          </button>
          <button className="btn" disabled={!file} onClick={() => void saveAs()}>
            Save as…
          </button>
          <div className="spacer" />
          {movable.length > 0 && (
            <button className="btn" disabled={!ready} onClick={() => void saveAndMove()} title="Save, stop the project, copy the data into the named volumes, then bring it up">
              Save and move data…
            </button>
          )}
          <button className="btn primary" disabled={!ready} onClick={() => void saveInPlace()} title="Copies each file to .bak, then saves the revised one in its place">
            {saving ? "Saving…" : "Save in place"}
          </button>
          <button className="btn" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
