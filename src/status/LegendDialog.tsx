// Help › Legend: every state's mark, colour and meaning.
import { useEffect, useRef } from "react";
import { StatusMark } from "../components/StatusMark";
import { STATES } from "./status";

export function LegendDialog({ onClose }: { onClose: () => void }) {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => ok.current?.focus(), []);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-modal
        aria-labelledby="legend-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="dialog-title" id="legend-title">
          What the colours mean
        </div>
        <div className="dialog-body">
          <table className="legend-table">
            <tbody>
              {STATES.map((s) => (
                <tr key={s.state}>
                  <td>
                    <StatusMark status={{ state: s.state, label: s.label, reason: s.meaning }} />{" "}
                    <span className={`fl-name st-${s.state}`}>{s.label}</span>
                  </td>
                  <td>{s.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            Hover over any mark to see why it has that state. Section names in the tree show counts for what needs attention: problems (red cross) and orphans
            (orange triangle).
          </p>
        </div>
        <div className="dialog-buttons">
          <div className="spacer" />
          <button className="btn primary" ref={ok} onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
