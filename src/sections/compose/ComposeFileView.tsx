// A project's compose files, read-only: one tab per file it was started from
// (or the pinned file), and a Resolved tab with `docker compose config`, the
// merged file with variables filled in. Resolved can hold secrets from .env
// files, so it's fetched only when asked for and dropped on Hide or leaving.
import { useEffect, useState } from "react";
import { composeApi, type ComposeFile, type ComposeTarget } from "../../api/compose";
import { toAppError, type AppError } from "../../api/core";
import { ErrorPanel } from "../../components/ErrorPanel";
import type { Shell } from "../../shell/shell";
import { fileName, yamlTokens } from "./projects";

const RESOLVED = -1;

interface Props {
  target: ComposeTarget;
  /** Shows an engine-side path the way Windows names it. */
  shown: (path: string) => string;
  shell: Shell;
}

type Loaded = { file: ComposeFile } | { error: AppError } | null;

export function ComposeFileView({ target, shown, shell }: Props) {
  const files = target.files;
  const [tab, setTab] = useState(files.length ? 0 : RESOLVED);
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [attempt, setAttempt] = useState(0);
  const [resolved, setResolved] = useState<{ text: string } | { error: AppError } | null>(null);
  const [resolving, setResolving] = useState(false);
  const path = tab >= 0 ? files[tab] : null;

  useEffect(() => {
    if (path === null) return;
    let stale = false;
    setLoaded(null);
    composeApi
      .readFile(path)
      .then((file) => !stale && setLoaded({ file }))
      .catch((e) => !stale && setLoaded({ error: toAppError(e) }));
    return () => {
      stale = true;
    };
  }, [path, attempt]);

  // Leaving the Resolved tab drops what it showed.
  useEffect(() => {
    if (tab !== RESOLVED) setResolved(null);
  }, [tab]);

  async function resolve() {
    setResolving(true);
    try {
      const out = await composeApi.resolved(target);
      setResolved(out.code === 0 ? { text: out.stdout } : { error: { kind: "invalid", message: out.stderr.trim() || "Compose couldn't read the project's files.", detail: "" } });
    } catch (e) {
      setResolved({ error: toAppError(e) });
    } finally {
      setResolving(false);
    }
  }

  async function show(how: "folder" | "open") {
    if (path === null) return;
    try {
      await composeApi.showFile(path, how);
    } catch (e) {
      shell.showError(e);
    }
  }

  const where = path === null ? "" : loaded && "file" in loaded ? loaded.file.path : shown(path);
  let body;
  if (tab === RESOLVED) {
    if (resolved === null)
      body = (
        <div className="empty-note center">
          <p>The resolved file is what Compose runs: every file merged, with variables filled in. Values from .env files show in full, so it may contain secrets.</p>
          <button className="btn primary" disabled={resolving} onClick={() => void resolve()}>
            {resolving ? "Running docker compose config…" : "Show resolved file"}
          </button>
        </div>
      );
    else if ("error" in resolved) body = <ErrorPanel error={resolved.error} onRetry={() => void resolve()} />;
    else body = <CodeView text={resolved.text} />;
  } else if (loaded === null) body = <div className="empty-note">Reading {fileName(path ?? "")}…</div>;
  else if ("error" in loaded)
    body = (
      <ErrorPanel
        error={{
          ...loaded.error,
          message:
            loaded.error.kind === "notFound"
              ? `${loaded.error.message} It may have moved or been deleted since the project started.`
              : loaded.error.message,
        }}
        onRetry={() => setAttempt((n) => n + 1)}
      />
    );
  else body = <CodeView text={loaded.file.text} />;

  return (
    <div className="section-pane compose-file-view">
      <div className="filter-bar">
        <div className="segmented" role="tablist" aria-label="Compose files">
          {files.map((f, i) => (
            <button key={f} role="tab" aria-selected={tab === i} className={tab === i ? "active" : ""} title={shown(f)} onClick={() => setTab(i)}>
              {fileName(f)}
            </button>
          ))}
          <button role="tab" aria-selected={tab === RESOLVED} className={tab === RESOLVED ? "active" : ""} title="docker compose config" onClick={() => setTab(RESOLVED)}>
            Resolved
          </button>
        </div>
        <span className="mono compose-file-path" title={where}>
          {where}
        </span>
        {tab === RESOLVED ? (
          resolved !== null && (
            <>
              {"text" in resolved && (
                <button className="btn" onClick={() => void shell.copyText(resolved.text).then(() => shell.showFlash("Copied the resolved file"))}>
                  Copy
                </button>
              )}
              <button className="btn" onClick={() => setResolved(null)} title="Hide the resolved file (it may contain secrets)">
                Hide
              </button>
            </>
          )
        ) : (
          <>
            <button className="btn" disabled={!where} onClick={() => void shell.copyText(where).then(() => shell.showFlash("Copied the path"))}>
              Copy path
            </button>
            <button className="btn" disabled={!loaded || !("file" in loaded)} onClick={() => void show("folder")} title="Show the file in File Explorer">
              Show in folder
            </button>
            <button className="btn" disabled={!loaded || !("file" in loaded)} onClick={() => void show("open")} title="Open the file in the app Windows uses for it">
              Open in editor
            </button>
          </>
        )}
      </div>
      {body}
    </div>
  );
}

/** Read-only text with line numbers; YAML keys and comments picked out. */
function CodeView({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  return (
    <div className="code-view" tabIndex={0}>
      <table>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="code-num">{i + 1}</td>
              <td className="code-line">
                {yamlTokens(l).map((t, j) => (t.kind === "text" ? <span key={j}>{t.text}</span> : <span key={j} className={`code-${t.kind}`}>{t.text}</span>))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
