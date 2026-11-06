// Small inline SVG icons in a classic-Explorer spirit. No icon library dependency.
type P = { size?: number };

export function FolderIcon({ size = 16, open = false }: P & { open?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M1 3.5 h5 l1.5 1.5 H15 v8.5 H1 Z" fill="#e8b84a" stroke="#a87a12" strokeWidth="0.8" />
      {open ? (
        <path d="M2.5 7 H15.5 L14 13.5 H1 Z" fill="#f8d775" stroke="#a87a12" strokeWidth="0.8" />
      ) : (
        <path d="M1 6.5 H15 V13.5 H1 Z" fill="#f8d775" stroke="#a87a12" strokeWidth="0.8" />
      )}
    </svg>
  );
}

export function FileIcon({ size = 16 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M3 1 h7 l3 3 v11 H3 Z" fill="#fff" stroke="#7a8794" strokeWidth="0.8" />
      <path d="M10 1 v3 h3" fill="#e4e9ee" stroke="#7a8794" strokeWidth="0.8" />
    </svg>
  );
}

export function ServerIcon({ size = 16 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <rect x="2" y="2" width="12" height="5" rx="1" fill="#e9eef3" stroke="#56636f" strokeWidth="0.8" />
      <rect x="2" y="9" width="12" height="5" rx="1" fill="#e9eef3" stroke="#56636f" strokeWidth="0.8" />
      <circle cx="11.5" cy="4.5" r="0.9" fill="#3aa655" />
      <circle cx="11.5" cy="11.5" r="0.9" fill="#3aa655" />
    </svg>
  );
}

const arrow = (d: string) =>
  function Arrow({ size = 16 }: P) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  };

export const BackIcon = arrow("M10 3 L5 8 L10 13");
export const ForwardIcon = arrow("M6 3 L11 8 L6 13");
export const UpIcon = arrow("M3 9 L8 4 L13 9 M8 4 V13");
export const UploadIcon = arrow("M8 12 V3 M4 7 L8 3 L12 7 M3 14 H13");
export const DownloadIcon = arrow("M8 3 V12 M4 8 L8 12 L12 8 M3 14 H13");
export const SyncIcon = arrow("M3 6 a5 5 0 0 1 9 -1.5 M12 2 V4.5 H9.5 M13 10 a5 5 0 0 1 -9 1.5 M4 14 V11.5 H6.5");
export const RefreshIcon = arrow("M13 8 a5 5 0 1 1 -1.5 -3.5 M13 2.5 V5 H10.5");

export function CopyIcon({ size = 16 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <rect x="5" y="5" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3 11 V3 a1 1 0 0 1 1 -1 H11" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function NewFolderIcon({ size = 16 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M1 3.5 h5 l1.5 1.5 H15 v8.5 H1 Z" fill="#f8d775" stroke="#a87a12" strokeWidth="0.8" />
      <path d="M8 7.5 v4 M6 9.5 h4" stroke="#7a5200" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function DeleteIcon({ size = 16 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M4 4 L12 12 M12 4 L4 12" stroke="#d13438" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function LockIcon({ size = 16, open = false }: P & { open?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <rect x="3" y="7" width="10" height="7.5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d={open ? "M5.5 7 V4.8 a2.5 2.5 0 0 1 5 -0.6" : "M5.5 7 V4.8 a2.5 2.5 0 0 1 5 0 V7"} fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function KeyIcon({ size = 16 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <circle cx="5" cy="8" r="3" fill="none" stroke="#c98a00" strokeWidth="1.6" />
      <path d="M8 8 H14.5 M12 8 V10.5 M14 8 V10" stroke="#c98a00" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function GearIcon({ size = 16 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 5.2 a2.8 2.8 0 1 0 0.01 0 Z M7 1 h2 l0.3 1.8 1.4 0.6 1.5 -1.1 1.4 1.4 -1.1 1.5 0.6 1.4 1.8 0.3 v2 l-1.8 0.3 -0.6 1.4 1.1 1.5 -1.4 1.4 -1.5 -1.1 -1.4 0.6 L9 15 H7 l-0.3 -1.8 -1.4 -0.6 -1.5 1.1 -1.4 -1.4 1.1 -1.5 -0.6 -1.4 L1 9 V7 l1.8 -0.3 0.6 -1.4 -1.1 -1.5 1.4 -1.4 1.5 1.1 1.4 -0.6 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function NewItemIcon({ size = 16 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M8 2.5 V13.5 M2.5 8 H13.5" stroke="#2f8a3a" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

export function EditIcon({ size = 16 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M3 13 L3.6 10.4 L10.8 3.2 L12.8 5.2 L5.6 12.4 Z" fill="#f2c94c" stroke="#8a6a00" strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M2.5 14 H13.5" stroke="currentColor" strokeWidth="0.9" />
    </svg>
  );
}

export function HistoryIcon({ size = 16 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M2.8 8 a5.2 5.2 0 1 0 1.6 -3.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.2 2.6 V5.4 H5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 5 V8.3 L10.3 9.6" fill="none" stroke="#3d6fa8" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function SendIcon({ size = 16 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M1.5 7.5 L14.5 2 L10 14 L7.5 9 Z" fill="none" stroke="#2f8a3a" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M7.5 9 L14.5 2" stroke="#2f8a3a" strokeWidth="1.1" />
    </svg>
  );
}

export function HomeIcon({ size = 16 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M2 8 L8 2.5 L14 8" fill="none" stroke="#5b7da8" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M3.5 7 V14 H12.5 V7" fill="#d6e9fb" stroke="#5b7da8" strokeWidth="0.9" />
      <path d="M6.6 14 V10 H9.4 V14" fill="#fff" stroke="#5b7da8" strokeWidth="0.8" />
    </svg>
  );
}

/** Icon for the sample "Local files" section (a drive). */
export function DriveIcon({ size = 16 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <rect x="1.5" y="5" width="13" height="7" rx="1.2" fill="#e4e9ee" stroke="#6b7785" strokeWidth="0.9" />
      <path d="M1.8 9.5 H14.2" stroke="#6b7785" strokeWidth="0.7" />
      <circle cx="12" cy="10.8" r="0.7" fill="#3fb950" />
    </svg>
  );
}
