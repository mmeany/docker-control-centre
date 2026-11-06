// The mark for a state: shape and colour both carry it (colour-blind safe).
// Colours come from the st-<state> class (tokens in styles.css).
import type { Status, StatusState } from "../status/status";

function shape(state: StatusState) {
  switch (state) {
    case "running":
      return <circle cx="5" cy="5" r="4" fill="currentColor" />;
    case "starting":
      return (
        <>
          <circle cx="5" cy="5" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="5" cy="5" r="1.8" fill="currentColor" />
        </>
      );
    case "paused":
      return (
        <>
          <rect x="1.8" y="1.5" width="2.2" height="7" fill="currentColor" />
          <rect x="6" y="1.5" width="2.2" height="7" fill="currentColor" />
        </>
      );
    case "restarting":
      return (
        <>
          <path d="M8.3 5 A3.3 3.3 0 1 1 6.9 2.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M5.6 0.6 L8.6 2.2 L6.1 4.2 Z" fill="currentColor" />
        </>
      );
    case "partial":
    case "idle":
      return (
        <>
          <circle cx="5" cy="5" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M5 1.1 A3.9 3.9 0 0 0 5 8.9 Z" fill="currentColor" />
        </>
      );
    case "error":
      return <path d="M1.8 1.8 L8.2 8.2 M8.2 1.8 L1.8 8.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />;
    case "orphaned":
      return (
        <>
          <path d="M5 0.8 L9.4 8.9 H0.6 Z" fill="currentColor" />
          <path d="M5 3.6 V6.1" stroke="var(--pane)" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="5" cy="7.4" r="0.6" fill="var(--pane)" />
        </>
      );
    case "down":
      return <circle cx="5" cy="5" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.6 1.4" />;
    case "stopped":
    case "unused":
      return <circle cx="5" cy="5" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.3" />;
  }
}

export function StatusMark({ status }: { status: Status }) {
  return (
    <svg className={`status-mark st-${status.state}`} width="10" height="10" viewBox="0 0 10 10" role="img" aria-label={status.label}>
      {shape(status.state)}
    </svg>
  );
}

/** "Running: Running and healthy." for tooltips. */
export const statusTip = (s: Status) => (s.reason.startsWith(s.label) ? s.reason : `${s.label}: ${s.reason}`);
