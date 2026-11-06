import type { AppError } from "../api/core";

interface Props {
  error: AppError;
  onRetry?: () => void;
}

const TITLES: Record<AppError["kind"], string> = {
  notFound: "Not found",
  accessDenied: "Access denied",
  invalid: "Not valid",
  other: "Something went wrong",
};

/** Error shown in place of content, with Retry and the full detail. */
export function ErrorPanel({ error, onRetry }: Props) {
  return (
    <div className="error-panel" role="alert">
      <div className="error-title">⚠ {TITLES[error.kind] ?? TITLES.other}</div>
      <p>{error.message}</p>
      {onRetry && (
        <div className="error-actions">
          <button className="btn primary" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
      {error.detail && error.detail !== error.message && (
        <details>
          <summary>Details</summary>
          <pre>{error.detail}</pre>
        </details>
      )}
    </div>
  );
}
