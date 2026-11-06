// Files inside containers.
import { call } from "./core";

export type FileKind = "file" | "dir" | "link" | "linkDir" | "other";

export interface FileEntry {
  name: string;
  kind: FileKind;
  size: number;
  /** ISO 8601 UTC; "" if unknown. */
  modified: string;
  /** "-rw-r--r--" (exec) or octal "644" (archive). */
  mode: string;
}

export interface Listing {
  path: string;
  entries: FileEntry[];
  /** "exec": listed by a shell in the container; "archive": read from the archive API. */
  method: "exec" | "archive";
  /** The folder was too big to read fully without a shell. */
  truncated: boolean;
}

export interface CopyResult {
  /** "file": saved as itself; "tar": a folder, saved as an archive. */
  savedAs: "file" | "tar";
  bytes: number;
}

export const filesApi = {
  list: (id: string, path: string, running: boolean) => call<Listing>("list_container_dir", { id, path, running }),
  copyOut: (id: string, path: string, dest: string) => call<CopyResult>("copy_from_container", { id, path, dest }),
  /** Files and folders from this computer into `dir`; resolves with the file count. */
  copyIn: (id: string, dir: string, sources: string[]) => call<number>("copy_into_container", { id, dir, sources }),
};
