// Pulling an image, with progress per layer. Cancel stops the download.
import { useEffect, useRef, useState } from "react";
import type { AppError } from "../../api/core";
import { resourcesApi, type LayerProgress } from "../../api/resources";
import { streamsApi } from "../../api/streams";
import { formatSize } from "../../format";
import { DialogHelp } from "../../components/HelpDialog";

interface Props {
  reference: string;
  /** Called once: null on success, the error otherwise ("" when cancelled). */
  onDone: (error: string | null) => void;
}

const DONE = /complete|already exists/i;

export function PullDialog({ reference, onDone }: Props) {
  const [layers, setLayers] = useState<LayerProgress[]>([]);
  const [status, setStatus] = useState("Starting…");
  const stream = useRef<number | null>(null);
  const finished = useRef(false);

  useEffect(() => {
    let live = true;
    const finish = (error: string | null) => {
      if (finished.current) return;
      finished.current = true;
      onDone(error);
    };
    resourcesApi
      .pullImage(reference, (m) => {
        if (!live) return;
        if (m.type === "progress") {
          setLayers(m.layers);
          if (m.status) setStatus(m.status);
        } else finish(m.error);
      })
      .then((id) => {
        stream.current = id;
        if (!live) void streamsApi.stop(id).catch(() => {});
      })
      .catch((e) => finish((e as AppError).message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference]);

  function cancel() {
    if (stream.current !== null) void streamsApi.stop(stream.current).catch(() => {});
    if (!finished.current) {
      finished.current = true;
      onDone("");
    }
  }

  const known = layers.filter((l) => l.total > 0);
  const total = known.reduce((t, l) => t + l.total, 0);
  const current = known.reduce((t, l) => t + Math.min(l.current, l.total), 0);
  const doneCount = layers.filter((l) => DONE.test(l.status)).length;

  return (
    <div className="modal-backdrop">
      <div className="dialog dialog-wide" role="dialog" aria-modal aria-labelledby="pull-title" onKeyDown={(e) => e.key === "Escape" && cancel()}>
        <div className="dialog-title" id="pull-title">
          Pulling {reference}
          <DialogHelp topic="images.pull" />
        </div>
        <div className="dialog-body">
          <div className="pull-summary">
            <span>{status}</span>
            <span className="hint">
              {doneCount} of {layers.length} layers{total ? ` · ${formatSize(current)} of ${formatSize(total)}` : ""}
            </span>
          </div>
          <div className="progress">
            <div className="progress-track">
              <div className={`progress-fill ${total ? "" : "indeterminate"}`} style={total ? { width: `${Math.round((current / total) * 100)}%` } : undefined} />
            </div>
          </div>
          <div className="pull-layers">
            {layers.map((l) => (
              <div key={l.id} className="pull-layer">
                <span className="mono">{l.id}</span>
                <span className="pull-status">{l.status}</span>
                <span className="hint">{l.total ? `${formatSize(Math.min(l.current, l.total))} / ${formatSize(l.total)}` : ""}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="dialog-buttons">
          <div className="spacer" />
          <button className="btn" onClick={cancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
