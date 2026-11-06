// A shell inside the container (docker exec -it), in xterm.js.
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import type { ContainerItem } from "../../api/engine";
import { streamsApi } from "../../api/streams";

interface Props {
  container: ContainerItem;
  onPopOut?: () => void;
}

/** xterm colours from the app's theme tokens. */
function themeFromCss() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { background: v("--term-bg"), foreground: v("--term-fg"), cursor: v("--term-fg"), selectionBackground: v("--sel") };
}

export function TerminalView({ container, onPopOut }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const running = container.state === "running";

  useEffect(() => {
    if (!running || !host.current) return;
    const term = new Terminal({
      fontFamily: '"Cascadia Mono", Consolas, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: themeFromCss(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();
    term.focus();

    let session: number | null = null;
    let live = true;
    setStatus("connecting");
    setMessage("");
    streamsApi
      .terminalOpen(container.id, term.cols, term.rows, (m) => {
        if (!live) return;
        if (m.type === "output") term.write(m.data);
        else {
          setStatus("closed");
          setMessage(m.message ?? (m.code === null ? "The shell ended." : `The shell ended with exit code ${m.code}.`));
          session = null;
        }
      })
      .then((id) => {
        if (!live) {
          void streamsApi.terminalClose(id).catch(() => {});
          return;
        }
        session = id;
        setStatus("open");
      })
      .catch((e) => {
        if (!live) return;
        setStatus("closed");
        setMessage((e as { message?: string }).message ?? String(e));
      });

    const input = term.onData((data) => {
      if (session !== null) void streamsApi.terminalInput(session, data).catch(() => {});
    });
    const resized = term.onResize(({ cols, rows }) => {
      if (session !== null) void streamsApi.terminalResize(session, cols, rows).catch(() => {});
    });
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* hidden: nothing to fit */
      }
    });
    ro.observe(host.current);
    // Follow the app's light / dark switch.
    const mo = new MutationObserver(() => (term.options.theme = themeFromCss()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      live = false;
      ro.disconnect();
      mo.disconnect();
      input.dispose();
      resized.dispose();
      if (session !== null) void streamsApi.terminalClose(session).catch(() => {});
      // xterm queues a viewport sync when it opens; disposing before that runs
      // throws ("reading 'dimensions'"), so let it run first.
      window.setTimeout(() => term.dispose(), 0);
    };
  }, [container.id, running, attempt]);

  if (!running) {
    return <div className="empty-note center">{container.name} isn't running. Start it to open a terminal.</div>;
  }
  return (
    <div className="section-pane terminal-view">
      <div className="filter-bar">
        <span className="field-label">{status === "connecting" ? "Connecting…" : status === "open" ? `Shell in ${container.name}` : message}</span>
        <div className="spacer" />
        {status === "closed" && (
          <button className="btn primary" onClick={() => setAttempt((n) => n + 1)}>
            Reconnect
          </button>
        )}
        {onPopOut && (
          <button className="btn" onClick={onPopOut} title="Open the terminal in its own window">
            Pop out
          </button>
        )}
      </div>
      <div className="terminal-host" ref={host} />
    </div>
  );
}
