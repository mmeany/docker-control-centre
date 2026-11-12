// About: what the app is, its version, the engine it's connected to, and
// where to report bugs and ask for features.
import { useEffect, useRef, useState } from "react";
import { appApi, type AboutInfo } from "../api/app";

interface Props {
  /** The engine endpoint, when connected. */
  endpoint: string | null;
  onClose: () => void;
  onError: (e: unknown) => void;
}

const NAME = "Docker Control Centre";

export function AboutDialog({ endpoint, onClose, onError }: Props) {
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  useEffect(() => {
    appApi.aboutInfo().then(setInfo, onError);
    // Once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = () => appApi.openProjectPage().catch(onError);
  const name = info?.name ?? NAME;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="dialog about-dialog"
        role="dialog"
        aria-modal
        aria-labelledby="about-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="dialog-title" id="about-title">
          About {name}
        </div>
        <div className="dialog-body about-body">
          <div className="about-name">
            {name}
            {info && <span className="about-version">version {info.version}</span>}
          </div>
          <p>
            Manage a Docker engine the way File Explorer manages files: containers, Compose projects, images, volumes and networks as folders, with logs,
            terminals, stats and files inside containers. Built for Docker Engine in WSL, and works with any engine on <span className="mono">DOCKER_HOST</span>.
          </p>
          <p className="hint">Connected to {endpoint ?? "no engine"}.</p>
          <p>
            Source code, releases and the issue tracker are on GitHub. Please report bugs and request features there:
            <br />
            <button className="link-btn about-link" title="Open in your browser" onClick={() => void open()}>
              {info?.projectUrl ?? "github.com/mmeany/docker-control-centre"}
            </button>
          </p>
          <p className="hint">Open source under the MIT or Apache-2.0 licence. Not affiliated with or endorsed by Docker, Inc.</p>
          <p className="about-credit">Lovingly created by Claude Code under the direction of Mark Meany.</p>
        </div>
        <div className="dialog-buttons">
          <div className="spacer" />
          <button ref={closeRef} className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
