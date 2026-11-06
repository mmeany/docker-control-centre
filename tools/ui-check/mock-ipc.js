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
  let streamId = 0;
  const timers = {};
  const terminals = {};
  const channelIndex = {};
  /** Delivers a message on any channel, in order. */
  const send = (channel, message) => {
    const i = (channelIndex[channel.id] = (channelIndex[channel.id] ?? -1) + 1);
    callbacks[channel.id]?.({ index: i, message });
  };
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
    inspect_container: (a) => {
      const c = containers.find((x) => x.id === a.id);
      if (!c) throw { kind: "notFound", message: `No such container: ${a.id}`, detail: "" };
      const [port, host] = (c.ports[0] || "").split("→").reverse();
      return {
        id: c.id,
        name: c.name,
        image: c.image,
        imageId: "sha256:" + c.id,
        command: c.image.startsWith("nginx") ? '/docker-entrypoint.sh nginx -g "daemon off;"' : "docker-entrypoint.sh",
        created: c.created,
        state: c.state,
        startedAt: c.created,
        finishedAt: c.state === "exited" ? iso(2) : "",
        exitCode: c.state === "exited" ? 0 : null,
        error: "",
        health: c.name === "postgres" ? "healthy" : "",
        restartPolicy: c.project ? "unless-stopped" : "no",
        restartCount: 0,
        platform: "linux",
        workingDir: "/",
        user: "",
        hostname: c.id.slice(0, 12),
        project: c.project,
        service: c.service,
        projectDir: c.workingDir,
        env: [
          { key: "PATH", value: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
          { key: "POSTGRES_PASSWORD", value: "example-only" },
          { key: "TZ", value: "Europe/London" },
        ],
        labels: c.project
          ? [
              { key: "com.docker.compose.project", value: c.project },
              { key: "com.docker.compose.service", value: c.service },
            ]
          : [],
        mounts: c.project ? [{ kind: "bind", name: "", source: `${c.workingDir}/data`, destination: "/data", mode: "rw", readWrite: true }] : [],
        ports: port ? [{ containerPort: port, host: host ? [`0.0.0.0:${host}`, `[::]:${host}`] : [] }] : [],
        networks: [{ name: c.project ? `${c.project}_default` : "bridge", ipAddress: "172.18.0.2/16", gateway: "172.18.0.1", macAddress: "02:42:ac:12:00:02", aliases: c.service ? [c.service, c.name] : [] }],
      };
    },
    container_action: (a) => {
      const results = a.ids.map((id) => {
        const i = containers.findIndex((x) => x.id === id);
        if (i < 0) return { id, error: "No such container" };
        const c = containers[i];
        const t = a.action.type;
        if (t === "remove") containers.splice(i, 1);
        else if (t === "start" || t === "restart" || t === "unpause") Object.assign(c, { state: "running", status: "Up 1 second" });
        else if (t === "pause") Object.assign(c, { state: "paused", status: "Up 3 hours (Paused)" });
        else Object.assign(c, { state: "exited", status: `Exited (${t === "kill" ? 137 : 0}) 1 second ago` });
        return { id, error: null };
      });
      setTimeout(() => window.__engine({ type: "changed", resource: "container", action: a.action.type, id: a.ids[0] }), 10);
      return results;
    },
    // Streams: a little output now, more on a timer while "following".
    stream_logs: (a) => {
      const id = ++streamId;
      const c = containers.find((x) => x.id === a.id);
      const t0 = now - 600_000;
      const lines = Array.from({ length: 300 }, (_, i) => ({
        err: i % 37 === 0,
        time: new Date(t0 + i * 1000).toISOString(),
        text: i % 37 === 0 ? `ERROR request ${i} failed: upstream timed out` : `${c ? c.name : "?"} GET /api/items/${i} 200 ${(i * 7) % 90}ms`,
      }));
      setTimeout(() => send(a.onMessage, { type: "lines", lines }), 20);
      if (a.query.follow) {
        let n = 300;
        timers[id] = setInterval(() => send(a.onMessage, { type: "lines", lines: [{ err: false, time: new Date().toISOString(), text: `GET /health 200 ${n++}` }] }), 1000);
      } else setTimeout(() => send(a.onMessage, { type: "end", error: null }), 40);
      return id;
    },
    stop_stream: (a) => (clearInterval(timers[a.stream]), null),
    export_logs: () => 300,
    terminal_open: (a) => {
      const id = ++streamId;
      terminals[id] = a.onMessage;
      setTimeout(() => send(a.onMessage, { type: "output", data: "root@" + a.id.slice(0, 12) + ":/# " }), 20);
      return id;
    },
    terminal_input: (a) => {
      const ch = terminals[a.session];
      if (ch) send(ch, { type: "output", data: a.data === "\r" ? "\r\n# " : a.data });
      return null;
    },
    terminal_resize: () => null,
    terminal_close: (a) => (delete terminals[a.session], null),
    stream_stats: (a) => {
      const id = ++streamId;
      let k = 0;
      const tick = () => {
        k++;
        send(a.onMessage, {
          time: new Date().toISOString(),
          cpuPercent: 20 + 15 * Math.sin(k / 3),
          onlineCpus: 8,
          memUsed: 180e6 + k * 1e5,
          memLimit: 8e9,
          netRx: k * 52_000,
          netTx: k * 18_000,
          blockRead: 4e6,
          blockWrite: k * 4096,
          pids: 12,
        });
      };
      tick();
      timers[id] = setInterval(tick, 1000);
      return id;
    },
    open_popout: (a) => ((window.__popouts = [...(window.__popouts || []), a]), null),
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
