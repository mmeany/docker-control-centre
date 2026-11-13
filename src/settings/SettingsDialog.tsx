// Settings: the layout (Explorer or dashboard), where `docker compose` runs
// (inside WSL, which a WSL engine needs for bind mounts, or on this machine)
// and which WSL distro.
import { useEffect, useState } from "react";
import { appApi } from "../api/app";
import type { AppError, Settings } from "../api/core";
import { composeApi, COMPOSE_DISTRO_KEY, COMPOSE_MODE_KEY, type ComposeOutput, type Distro } from "../api/compose";
import { LAYOUT_KEY, LAYOUTS, readLayout, type Layout } from "../shell/layout";
import { DialogHelp } from "../components/HelpDialog";
import { anyColumnLayouts, resetAllColumnLayouts } from "../state/columns";

interface Props {
  settings: Settings;
  onSaved: (s: Settings) => void;
  onClose: () => void;
}

export function SettingsDialog({ settings, onSaved, onClose }: Props) {
  const [layout, setLayout] = useState<Layout>(readLayout(settings.values[LAYOUT_KEY]));
  const [mode, setMode] = useState<"wsl" | "host">(settings.values[COMPOSE_MODE_KEY] === "host" ? "host" : "wsl");
  const [distro, setDistro] = useState(typeof settings.values[COMPOSE_DISTRO_KEY] === "string" ? (settings.values[COMPOSE_DISTRO_KEY] as string) : "");
  const [distros, setDistros] = useState<Distro[] | null>(null);
  const [test, setTest] = useState<{ busy: boolean; out: ComposeOutput | null; error: string | null }>({ busy: false, out: null, error: null });
  const [saving, setSaving] = useState(false);
  // Reset all column layouts: asks in place, then says when it's done.
  const [columnsReset, setColumnsReset] = useState<"idle" | "asking" | "done">("idle");
  const hasColumnLayouts = anyColumnLayouts(settings.values);

  async function resetColumns() {
    try {
      const s = await resetAllColumnLayouts(settings.values);
      if (s) onSaved(s);
      setColumnsReset("done");
    } catch (e) {
      setColumnsReset("idle");
      setTest({ busy: false, out: null, error: (e as AppError).message });
    }
  }

  useEffect(() => {
    composeApi
      .distros()
      .then(setDistros)
      .catch(() => setDistros([]));
  }, []);

  async function save(): Promise<boolean> {
    setSaving(true);
    try {
      await appApi.setValue(LAYOUT_KEY, layout);
      await appApi.setValue(COMPOSE_MODE_KEY, mode);
      onSaved(await appApi.setValue(COMPOSE_DISTRO_KEY, distro || null));
      return true;
    } catch (e) {
      setTest({ busy: false, out: null, error: (e as AppError).message });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    if (!(await save())) return;
    setTest({ busy: true, out: null, error: null });
    try {
      setTest({ busy: false, out: await composeApi.version(), error: null });
    } catch (e) {
      setTest({ busy: false, out: null, error: (e as AppError).message });
    }
  }

  const def = distros?.find((d) => d.default);
  const ok = test.out?.code === 0;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="dialog dialog-wide" role="dialog" aria-modal aria-labelledby="settings-title" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="dialog-title" id="settings-title">
          Settings
          <DialogHelp topic="settings" />
        </div>
        <div className="dialog-body">
          <fieldset className="radio-group">
            <legend>Layout</legend>
            {LAYOUTS.map((l) => (
              <label key={l.id} className="check-row">
                <input type="radio" name="layout" checked={layout === l.id} onChange={() => setLayout(l.id)} /> {l.label}: {l.title.charAt(0).toLowerCase() + l.title.slice(1)}
              </label>
            ))}
          </fieldset>
          <fieldset className="radio-group">
            <legend>Run docker compose</legend>
            <label className="check-row">
              <input type="radio" name="mode" checked={mode === "wsl"} onChange={() => setMode("wsl")} /> Inside WSL (for Docker Engine running in WSL: bind mounts resolve on the Linux side)
            </label>
            <label className="check-row">
              <input type="radio" name="mode" checked={mode === "host"} onChange={() => setMode("host")} /> On this computer (Docker Desktop, or Linux and macOS)
            </label>
          </fieldset>
          {mode === "wsl" && (
            <div className="form-grid settings-grid">
              <label className="form-label" htmlFor="distro">
                WSL distro
              </label>
              <select id="distro" className="select" value={distro} onChange={(e) => setDistro(e.target.value)} disabled={distros === null}>
                <option value="">Default{def ? ` (${def.name})` : ""}</option>
                {(distros ?? []).map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                    {d.running ? "" : " (stopped)"}
                    {d.version === 1 ? " (WSL 1)" : ""}
                  </option>
                ))}
              </select>
              {distros !== null && distros.length === 0 && <p className="warn-note">No WSL distros found. Install one, or run compose on this computer.</p>}
            </div>
          )}
          <div className="settings-test">
            <button className="btn" onClick={() => void runTest()} disabled={test.busy}>
              {test.busy ? "Testing…" : "Test"}
            </button>
            <span className="hint">Saves, then runs docker compose version the way projects will run.</span>
          </div>
          {test.error && <p className="warn-note">{test.error}</p>}
          {test.out && (
            <pre className={ok ? "ok-note" : "warn-note"}>{(test.out.stdout + test.out.stderr).trim() || `Exit code ${test.out.code}`}</pre>
          )}
          <fieldset className="radio-group">
            <legend>Columns</legend>
            {columnsReset === "asking" ? (
              <div className="warn-note settings-columns">
                <span>Every list and table goes back to its default column widths, and hidden columns show again. This can't be undone.</span>
                <button className="btn danger" onClick={() => void resetColumns()}>
                  Reset
                </button>
                <button className="btn" onClick={() => setColumnsReset("idle")}>
                  Keep
                </button>
              </div>
            ) : (
              <div className="settings-test">
                <button className="btn" onClick={() => setColumnsReset("asking")} disabled={columnsReset === "done" || !hasColumnLayouts}>
                  Reset all column layouts…
                </button>
                <span className="hint">
                  {columnsReset === "done"
                    ? "Every list and table is back to its default columns."
                    : hasColumnLayouts
                      ? "Column widths and hidden columns in every list and table."
                      : "No list or table has changed columns."}
                </span>
              </div>
            )}
          </fieldset>
        </div>
        <div className="dialog-buttons">
          <div className="spacer" />
          <button
            className="btn primary"
            disabled={saving}
            onClick={async () => {
              if (await save()) onClose();
            }}
          >
            Save
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
