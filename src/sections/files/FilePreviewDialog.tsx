// Text preview for the sample section: JSON as a tree, other text as text.
import { useEffect, useState } from "react";
import type { AppError } from "../../api/core";
import { filesApi, type TextFile } from "../../api/files";
import { ValueView } from "../../components/ValueView";
import { formatSize } from "../../format";
import { baseName } from "./paths";

export function FilePreviewDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const [file, setFile] = useState<TextFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    filesApi
      .readText(path)
      .then((f) => !stale && setFile(f))
      .catch((e) => !stale && setError((e as AppError).message ?? String(e)));
    return () => {
      stale = true;
    };
  }, [path]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="dialog preview-dialog"
        role="dialog"
        aria-modal
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="dialog-title">
          {baseName(path)} {file && <span className="hint">· {formatSize(file.size)}</span>}
        </div>
        <div className="dialog-body preview-body">
          {error ? (
            <div className="field-error">{error}</div>
          ) : !file ? (
            <div className="hint">Loading…</div>
          ) : file.binary ? (
            <div className="hint">This looks like a binary file, so there's nothing to preview.</div>
          ) : (
            <>
              {file.truncated && <div className="warn-note">Only the first part of this file is shown.</div>}
              <ValueView value={file.text} />
            </>
          )}
        </div>
        <div className="dialog-buttons">
          <div className="spacer" />
          <button className="btn primary" autoFocus onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
