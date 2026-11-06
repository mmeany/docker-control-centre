// Sample section's commands: list a local folder, read a text file.
import { call } from "./core";

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  /** ISO 8601 (UTC), when the OS reports it. */
  modified: string | null;
  hidden: boolean;
}

export interface TextFile {
  text: string;
  size: number;
  /** Only the first part was read. */
  truncated: boolean;
  /** Looks binary (contains NUL bytes); `text` is empty. */
  binary: boolean;
}

export const filesApi = {
  homeDir: () => call<string | null>("home_dir"),
  listDir: (path: string) => call<DirEntry[]>("list_dir", { path }),
  readText: (path: string) => call<TextFile>("read_text", { path }),
};
