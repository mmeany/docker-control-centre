import type { ReactNode } from "react";

interface Props {
  left: string;
  middle?: ReactNode;
  right: ReactNode;
  /** Tooltip for the right-hand cell. */
  rightTitle?: string;
}

export function StatusBar({ left, middle, right, rightTitle }: Props) {
  return (
    <div className="status-bar">
      <span className="status-cell grow">{left}</span>
      {middle && <span className="status-cell">{middle}</span>}
      <span className="status-cell" title={rightTitle}>
        {right}
      </span>
    </div>
  );
}
