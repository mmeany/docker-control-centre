import type { ReactNode } from "react";

interface Props {
  left: string;
  middle?: ReactNode;
  right: ReactNode;
  /** Tooltip for the right-hand cell. */
  rightTitle?: string;
  /** After the right-hand cell (a pop-out's help button). */
  end?: ReactNode;
}

export function StatusBar({ left, middle, right, rightTitle, end }: Props) {
  return (
    <div className="status-bar">
      <span className="status-cell grow">{left}</span>
      {middle && <span className="status-cell">{middle}</span>}
      <span className="status-cell" title={rightTitle}>
        {right}
      </span>
      {end && <span className="status-cell status-end">{end}</span>}
    </div>
  );
}
