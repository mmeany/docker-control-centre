// Runs in the page before the app loads: a fake window.__TAURI_INTERNALS__ so
// invoke() calls reach the handlers below instead of Rust. Add a handler for
// every command your screens call (an unhandled one fails the check).
// Scenarios can override or add handlers at runtime: window.__mock[cmd] = fn,
// and push engine messages with window.__engine(message).
(() => {
  const now = Date.now();
  const iso = (hoursAgo) => new Date(now - hoursAgo * 3600000).toISOString().replace(/\.\d+Z$/, "Z");
  let n = 0;
  const container = (name, image, state, status, opts = {}) => ({
    id: (++n).toString(16).padStart(4, "0").repeat(16),
    name,
    image,
    state,
    status,
    created: iso(opts.age ?? 30),
    ports: opts.ports ?? [],
    project: opts.project ?? null,
    service: opts.service ?? null,
    workingDir: opts.project ? `/mnt/e/projects/${opts.project}` : null,
  });
  const containers = [
    container("shop-web-1", "nginx:1.27", "running", "Up 3 hours", { project: "shop", service: "web", ports: ["8080→80/tcp"] }),
    container("shop-api-1", "shop-api:latest", "running", "Up 3 hours", { project: "shop", service: "api", ports: ["3000→3000/tcp"] }),
    container("shop-worker-1", "shop-api:latest", "exited", "Exited (0) 2 hours ago", { project: "shop", service: "worker" }),
    container("monitoring-prometheus-1", "prom/prometheus:v3.1.0", "running", "Up 2 days", { project: "monitoring", service: "prometheus", ports: ["9090→9090/tcp"], age: 60 }),
    container("monitoring-grafana-1", "grafana/grafana:11.4.0", "paused", "Up 2 days (Paused)", { project: "monitoring", service: "grafana", ports: ["3001→3000/tcp"], age: 60 }),
    container("postgres", "postgres:17", "running", "Up 5 days", { ports: ["5432→5432/tcp"], age: 130 }),
    container("redis-scratch", "redis:7.4", "exited", "Exited (137) 3 days ago", { age: 80 }),
  ];

  const settings = { theme: window.__UI_CHECK_THEME__ || "dark", filterHistory: {}, values: {} };
  let engineChannel = null;
  let engineIndex = 0;
  const handlers = {
    get_settings: () => settings,
    set_theme: (a) => ((settings.theme = a.theme), settings),
    remember_filter: (a) => {
      const h = (settings.filterHistory[a.key] || []).filter((v) => v !== a.value);
      return (settings.filterHistory[a.key] = [a.value, ...h].slice(0, 10));
    },
    forget_filter: (a) => (settings.filterHistory[a.key] = a.value === null ? [] : (settings.filterHistory[a.key] || []).filter((v) => v !== a.value)),
    set_value: (a) => (a.value === null ? delete settings.values[a.key] : (settings.values[a.key] = a.value), settings),
    pick_folder: () => null,
    pick_open_file: () => null,
    pick_save_file: () => null,
    engine_info: () => ({
      name: "ubuntu-dev",
      endpoint: "tcp://localhost:2375",
      serverVersion: "28.5.1",
      operatingSystem: "Ubuntu 24.04.3 LTS",
      containers: containers.length,
      running: containers.filter((c) => c.state === "running").length,
      images: 31,
    }),
    // Copies, like real IPC: the app must not see the scenario's edits in place.
    list_containers: () => JSON.parse(JSON.stringify(containers)),
    watch_engine: (a) => {
      engineChannel = a.onMessage;
      engineIndex = 0;
      setTimeout(() => window.__engine({ type: "connected" }), 20);
      return null;
    },
  };

  window.__mock = {};
  window.__calls = [];
  const callbacks = {};
  let nextId = 1;
  /** Delivers a message on the engine channel, as Rust would. */
  window.__engine = (message) => engineChannel && callbacks[engineChannel.id]?.({ index: engineIndex++, message });
  window.__containers = containers;
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
