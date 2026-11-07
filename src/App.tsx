// App shell. useAppShell holds everything that doesn't depend on the layout
// (settings, session, navigation, the Shell, every section's hook, keyboard,
// shared dialogs); the layout the user chose (Explorer or dashboard) places it
// on screen. Pop-out windows always use the Explorer frame (main panel only).
// Each section (src/sections/*) supplies its tree branch, content, commands
// and status through a hook registered in src/sections/index.ts.
import { DashboardLayout } from "./shell/DashboardLayout";
import { ExplorerLayout } from "./shell/ExplorerLayout";
import { useAppShell } from "./shell/useAppShell";

/** Shown in the toolbar; the window title comes from tauri.conf.json. */
export const APP_TITLE = "Docker Control Centre";

export default function App() {
  const app = useAppShell();
  // Until settings load the layout isn't known; drawing Explorer first would flash.
  if (!app.ready) return <div className="app">{app.overlays}</div>;
  if (app.popout || app.layout === "explorer") return <ExplorerLayout app={app} />;
  return <DashboardLayout app={app} />;
}
