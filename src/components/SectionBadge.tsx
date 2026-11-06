// Counts after a section's name, only for what needs attention: problems
// (red cross) and orphans (orange triangle). Nothing when all is well.
import { StatusMark } from "./StatusMark";

interface Props {
  errors: number;
  orphans: number;
}

export function SectionBadge({ errors, orphans }: Props) {
  if (!errors && !orphans) return null;
  return (
    <>
      {errors > 0 && (
        <span className="tree-badge st-error" title={`${errors} with a problem`}>
          {errors}
          <StatusMark status={{ state: "error", label: "Problem", reason: "" }} />
        </span>
      )}
      {orphans > 0 && (
        <span className="tree-badge st-orphaned" title={`${orphans} orphaned: safe to prune`}>
          {orphans}
          <StatusMark status={{ state: "orphaned", label: "Orphaned", reason: "" }} />
        </span>
      )}
    </>
  );
}

/** "2 with problems · 3 orphaned", or "". */
export function attentionText({ errors, orphans }: Props): string {
  return [errors && `${errors} with ${errors === 1 ? "a problem" : "problems"}`, orphans && `${orphans} orphaned`].filter(Boolean).join(" · ");
}
