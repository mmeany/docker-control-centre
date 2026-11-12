// App-level commands: settings, remembered filters and values, native dialogs, About.
import { call, type Settings, type ThemePref } from "./core";

export const appApi = {
  getSettings: () => call<Settings>("get_settings"),
  setTheme: (theme: ThemePref) => call<Settings>("set_theme", { theme }),
  /** Remembers a filter (newest first, last 10); returns the history. */
  rememberFilter: (key: string, value: string) => call<string[]>("remember_filter", { key, value }),
  /** Forgets one filter, or the whole history when value is null. */
  forgetFilter: (key: string, value: string | null) => call<string[]>("forget_filter", { key, value }),
  /** Stores a small JSON value in settings (null removes it). */
  setValue: (key: string, value: unknown) => call<Settings>("set_value", { key, value }),

  // Native dialogs (null / empty when cancelled)
  pickFolder: (title: string) => call<string | null>("pick_folder", { title }),
  pickOpenFile: (title: string, filterName: string, extensions: string[]) =>
    call<string | null>("pick_open_file", { title, filterName, extensions }),
  pickSaveFile: (title: string, defaultName: string) => call<string | null>("pick_save_file", { title, defaultName }),

  /** Name, version and project address for About. */
  aboutInfo: () => call<AboutInfo>("about_info"),
  /** Opens the project page (a fixed address) in the default browser. */
  openProjectPage: () => call<void>("open_project_page"),
};

export interface AboutInfo {
  name: string;
  version: string;
  projectUrl: string;
}
