// Runs in the page before the app loads: a fake window.__TAURI_INTERNALS__ so
// invoke() calls reach the handlers below instead of Rust. Add a handler for
// every command your screens call (an unhandled one fails the check).
// Scenarios can override or add handlers at runtime: window.__mock[cmd] = fn.
(() => {
  const SEP = "/";
  const HOME = "/home/demo";
  // A small fake file system: folder path -> entries.
  const now = Date.now();
  const iso = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString().replace(/\.\d+Z$/, "Z");
  const file = (dir, name, size, daysAgo, hidden = false) => ({ name, path: dir + SEP + name, isDir: false, size, modified: iso(daysAgo), hidden });
  const folder = (dir, name, daysAgo, hidden = false) => ({ name, path: dir + SEP + name, isDir: true, size: 0, modified: iso(daysAgo), hidden });
  const fs = {
    [HOME]: [folder(HOME, "Documents", 2), folder(HOME, "Projects", 1), folder(HOME, ".config", 30, true), file(HOME, "notes.txt", 1834, 3), file(HOME, ".profile", 220, 90, true)],
    [HOME + "/Documents"]: [file(HOME + "/Documents", "report.json", 4210, 5), file(HOME + "/Documents", "budget.csv", 18342, 8), file(HOME + "/Documents", "photo.png", 2048000, 40)],
    [HOME + "/Projects"]: [folder(HOME + "/Projects", "website", 1), file(HOME + "/Projects", "README.md", 912, 1)],
    [HOME + "/Projects/website"]: [file(HOME + "/Projects/website", "index.html", 1200, 1)],
  };
  for (let i = 0; i < 60; i++) fs[HOME + "/Documents"].push(file(HOME + "/Documents", `log-${String(i).padStart(3, "0")}.txt`, 1000 + i * 37, i % 20));
  const texts = {
    [HOME + "/notes.txt"]: "Things to try:\n- the filter box\n- Show hidden\n- Back / Forward / Up\n",
    [HOME + "/Documents/report.json"]: JSON.stringify({ title: "Quarterly report", quarter: "Q3", totals: { revenue: 125000, costs: 98000 }, regions: ["north", "south"], approved: true }),
  };

  const settings = { theme: window.__UI_CHECK_THEME__ || "dark", filterHistory: {}, values: {} };
  const handlers = {
    get_settings: () => settings,
    set_theme: (a) => ((settings.theme = a.theme), settings),
    remember_filter: (a) => {
      const h = (settings.filterHistory[a.key] || []).filter((v) => v !== a.value);
      return (settings.filterHistory[a.key] = [a.value, ...h].slice(0, 10));
    },
    forget_filter: (a) => (settings.filterHistory[a.key] = a.value === null ? [] : (settings.filterHistory[a.key] || []).filter((v) => v !== a.value)),
    set_value: (a) => (a.value === null ? delete settings.values[a.key] : (settings.values[a.key] = a.value), settings),
    pick_folder: () => HOME + "/Projects",
    pick_open_file: () => null,
    pick_save_file: () => null,
    home_dir: () => HOME,
    list_dir: (a) => {
      if (!fs[a.path]) throw { kind: "notFound", message: `${a.path} doesn't exist.`, detail: "" };
      return fs[a.path];
    },
    read_text: (a) => {
      const entry = Object.values(fs).flat().find((e) => e.path === a.path);
      if (a.path.endsWith(".png")) return { text: "", size: entry?.size ?? 0, truncated: false, binary: true };
      const text = texts[a.path] ?? `Contents of ${a.path}\n`;
      return { text, size: entry?.size ?? text.length, truncated: false, binary: false };
    },
  };

  window.__mock = {};
  window.__calls = [];
  const callbacks = {};
  let nextId = 1;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    transformCallback: (fn) => {
      const id = nextId++;
      callbacks[id] = fn;
      return id;
    },
    unregisterCallback: (id) => delete callbacks[id],
    invoke: async (cmd, args = {}) => {
      // Events and window APIs used by the shell (theme): accept quietly.
      if (cmd.startsWith("plugin:event|")) return cmd.endsWith("listen") ? args.handler : null;
      if (cmd.startsWith("plugin:window|")) return cmd.endsWith("theme") ? (settings.theme === "light" ? "light" : "dark") : null;
      window.__calls.push([cmd, args]);
      const h = window.__mock[cmd] || handlers[cmd];
      if (!h) throw { kind: "other", message: `ui-check: no mock for "${cmd}" (add it to tools/ui-check/mock-ipc.js)`, detail: "" };
      await new Promise((r) => setTimeout(r, 15));
      return h(args);
    },
  };
  // The event plugin's unlisten helper (called on unmount).
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
})();
