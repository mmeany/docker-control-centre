// Output of a compose run (up, down, pull, …) as it happens. Stop kills it.
import { useEffect, useRef, useState } from "react";
import type { AppError } from "../../api/core";
import { composeApi, type ComposeTarget, type ComposeVerb } from "../../api/compose";
import { streamsApi } from "../../api/streams";
import { DialogHelp } from "../../components/HelpDialog";

interface Props {
  title: string;
  target: ComposeTarget;
  verb: ComposeVerb;
  /** When the dialog closes; ok = exit code 0. */
  onClose: (ok: boolean) => void;
}

export function RunDialog({ title, target, verb, onClose }: Props) {
  const [lines, setLines] = useState<{ text: string; err: boolean }[]>([]);
  const [exit, setExit] = useState<{ code: number | null; error: string | null } | null>(null);
  const stream = useRef<number | null>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    composeApi
      .run(target, verb, (m) => {
        if (!live) return;
        if (m.type === "line") setLines((l) => [...l, { text: m.text, err: m.err }]);
        else setExit({ code: m.code, error: m.error });
      })
      .then((id) => {
        if (live) stream.current = id;
        else void streamsApi.stop(id).catch(() => {});
      })
      .catch((e) => live && setExit({ code: null, error: (e as AppError).message }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [lines, exit]);

  const running = exit === null;
  const ok = exit?.code === 0;
  function close() {
    if (running && stream.current !== null) void streamsApi.stop(stream.current).catch(() => {});
    onClose(ok);
  }

  return (
    <div className="modal-backdrop">
      <div className="dialog dialog-wide" role="dialog" aria-modal aria-labelledby="run-title" onKeyDown={(e) => e.key === "Escape" && !running && close()}>
        <div className="dialog-title" id="run-title">
          {title}
          <DialogHelp topic="compose.run" />
        </div>
        <div className="dialog-body">
          <div className="run-output" ref={body}>
            {lines.map((l, i) => (
              // Compose writes its normal progress to stderr, so only lines that say so are errors.
              <div key={i} className={/\b(error|Error|ERROR)\b/.test(l.text) ? "err" : ""}>
                {l.text || " "}
              </div>
            ))}
          </div>
          {running ? (
            <div className="progress">
              <div className="progress-track">
                <div className="progress-fill indeterminate" />
              </div>
              <span className="hint">Running…</span>
            </div>
          ) : ok ? (
            <p className="ok-note">Finished.</p>
          ) : (
            <p className="warn-note">{exit.error ?? `Compose stopped with exit code ${exit.code ?? "unknown"}.`}</p>
          )}
        </div>
        <div className="dialog-buttons">
          <div className="spacer" />
          <button className={`btn ${running ? "" : "primary"}`} onClick={close} autoFocus={!running}>
            {running ? "Stop" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
