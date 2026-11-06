// Runs in the page before the app loads: a fake window.__TAURI_INTERNALS__ so
// invoke() calls reach the handlers below instead of Rust. Add a handler for
// every command your screens call (an unhandled one fails the check).
// Scenarios can override or add handlers at runtime: window.__mock[cmd] = fn,
// and push engine messages with window.__engine(message).
(() => {
  const now = Date.now();
  const iso = (hoursAgo) => new Date(now - hoursAgo * 3600000).toISOString().replace(/\.\d+Z$/, "Z");
  let n = 0;
  const hex = (seed, len = 64) => Array.from({ length: len }, (_, i) => "0123456789abcdef"[Math.floor(seed / (i % 5 + 1) + i * 7) % 16]).join("");
  const imageIdOf = (ref) => "sha256:" + hex([...ref].reduce((t, ch) => (t * 31 + ch.charCodeAt(0)) % 1000003, 7));
  const image = (tags, size, daysAgo, id) => ({ id: id ?? imageIdOf(tags[0]), tags, digests: tags.map((t) => t.split(":")[0] + "@sha256:" + hex(t.length, 64)), created: iso(daysAgo * 24), size });
  const images = [
    image(["nginx:1.27"], 192e6, 20),
    image(["shop-api:latest", "shop-api:1.4.2"], 412e6, 2),
    image(["prom/prometheus:v3.1.0"], 287e6, 40),
    image(["grafana/grafana:11.4.0"], 478e6, 40),
    image(["postgres:17"], 438e6, 30),
    image(["redis:7.4"], 117e6, 60),
    image(["node:22-bookworm-slim"], 329e6, 15),
    image([], 88e6, 9, "sha256:" + hex(99)),
    image([], 41e6, 12, "sha256:" + hex(98)),
  ];
  const volumes = [
    { name: "shop_pgdata", driver: "local", mountpoint: "/var/lib/docker/volumes/shop_pgdata/_data", created: iso(300), scope: "local", anonymous: false, project: "shop", labels: [{ key: "com.docker.compose.project", value: "shop" }], options: [] },
    { name: "monitoring_prom", driver: "local", mountpoint: "/var/lib/docker/volumes/monitoring_prom/_data", created: iso(900), scope: "local", anonymous: false, project: "monitoring", labels: [], options: [] },
    { name: "old_cache", driver: "local", mountpoint: "/var/lib/docker/volumes/old_cache/_data", created: iso(2000), scope: "local", anonymous: false, project: null, labels: [], options: [] },
    { name: hex(5), driver: "local", mountpoint: "/var/lib/docker/volumes/x/_data", created: iso(500), scope: "local", anonymous: true, project: null, labels: [], options: [] },
  ];
  const network = (name, subnet, opts = {}) => ({ id: hex(name.length * 3), name, driver: opts.driver ?? "bridge", scope: "local", created: iso(800), internal: false, attachable: false, ipv6: false, subnets: subnet ? [subnet] : [], gateways: subnet ? [subnet.replace(/0\/16$/, "1")] : [], builtin: !!opts.builtin, project: opts.project ?? null, labels: [], options: [] });
  const networks = [
    network("bridge", "172.17.0.0/16", { builtin: true }),
    network("host", null, { builtin: true, driver: "host" }),
    network("none", null, { builtin: true, driver: "null" }),
    network("shop_default", "172.18.0.0/16", { project: "shop" }),
    network("monitoring_default", "172.19.0.0/16", { project: "monitoring" }),
    network("old_default", "172.20.0.0/16"),
  ];
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
    workingDir: opts.project ? `/home/mark/projects/${opts.project}` : null,
    configFiles: opts.project ? [`/home/mark/projects/${opts.project}/compose.yml`] : [],
    imageId: imageIdOf(image),
    volumes: opts.volumes ?? [],
    networks: opts.project ? [`${opts.project}_default`] : ["bridge"],
  });
  const containers = [
    container("shop-web-1", "nginx:1.27", "running", "Up 3 hours", { project: "shop", service: "web", ports: ["8080→80/tcp"] }),
    container("shop-api-1", "shop-api:latest", "running", "Up 3 hours", { project: "shop", service: "api", ports: ["3000→3000/tcp"], volumes: ["shop_pgdata"] }),
    container("shop-worker-1", "shop-api:latest", "exited", "Exited (0) 2 hours ago", { project: "shop", service: "worker" }),
    container("monitoring-prometheus-1", "prom/prometheus:v3.1.0", "running", "Up 2 days", { project: "monitoring", service: "prometheus", ports: ["9090→9090/tcp"], age: 60, volumes: ["monitoring_prom"] }),
    container("monitoring-grafana-1", "grafana/grafana:11.4.0", "paused", "Up 2 days (Paused)", { project: "monitoring", service: "grafana", ports: ["3001→3000/tcp"], age: 60 }),
    container("postgres", "postgres:17", "running", "Up 5 days", { ports: ["5432→5432/tcp"], age: 130 }),
    container("redis-scratch", "redis:7.4", "exited", "Exited (137) 3 days ago", { age: 80 }),
  ];

  const settings = { theme: window.__UI_CHECK_THEME__ || "dark", filterHistory: {}, values: {} };
  let engineChannel = null;
  let engineIndex = 0;
  let streamId = 0;
  let pinned = [{ name: "blog", file: "E:\\projects\\blog\\compose.yml" }];
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
    pick_open_file: () => "E:\\projects\\wiki\\compose.yml",
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
    list_images: () => JSON.parse(JSON.stringify(images)),
    inspect_image: (a) => {
      const i = images.find((x) => x.id === a.id);
      if (!i) throw { kind: "notFound", message: "No such image", detail: "" };
      return { ...i, platform: "linux/amd64", author: "", entrypoint: "/docker-entrypoint.sh", command: "nginx -g daemon off;", workingDir: "", user: "", exposedPorts: ["80/tcp"], env: [{ key: "PATH", value: "/usr/local/bin:/usr/bin" }], labels: [{ key: "maintainer", value: "NGINX Docker Maintainers" }], layers: 7, history: [
        { id: i.id, created: i.created, createdBy: 'CMD ["nginx" "-g" "daemon off;"]', size: 0, comment: "" },
        { id: "<missing>", created: i.created, createdBy: "COPY docker-entrypoint.sh / # buildkit", size: 1620, comment: "buildkit.dockerfile.v0" },
        { id: "<missing>", created: i.created, createdBy: "RUN /bin/sh -c set -x && apt-get update && apt-get install ...", size: 117e6, comment: "" },
      ] };
    },
    remove_images: (a) => {
      const results = a.refs.map((ref) => {
        const i = images.findIndex((x) => x.id === ref || x.tags.includes(ref));
        if (i < 0) return { id: ref, error: "No such image" };
        const im = images[i];
        if (containers.some((c) => c.imageId === im.id && !a.force)) return { id: ref, error: "conflict: image is being used by a container" };
        im.tags = im.tags.filter((t) => t !== ref);
        if (im.tags.length === 0 || ref === im.id) images.splice(i, 1);
        return { id: ref, error: null };
      });
      setTimeout(() => window.__engine({ type: "changed", resource: "image", action: "delete", id: "" }), 10);
      return results;
    },
    pull_image: (a) => {
      const id = ++streamId;
      const layers = ["a2318d6c47ec", "095d327c79ae", "bbfaa25db775"].map((l) => ({ id: l, status: "Pulling fs layer", current: 0, total: 0 }));
      let k = 0;
      timers[id] = setInterval(() => {
        k++;
        layers.forEach((l, j) => Object.assign(l, k > 6 + j ? { status: "Pull complete", current: 30e6, total: 30e6 } : { status: "Downloading", current: Math.min(30e6, k * 5e6), total: 30e6 }));
        send(a.onMessage, { type: "progress", layers, status: "Pulling from library/" + a.reference.split(":")[0] });
        if (k > 9) {
          clearInterval(timers[id]);
          images.push(image([a.reference.includes(":") ? a.reference : a.reference + ":latest"], 90e6, 0));
          send(a.onMessage, { type: "done", error: null, status: "Status: Downloaded newer image for " + a.reference });
          window.__engine({ type: "changed", resource: "image", action: "pull", id: "" });
        }
      }, 150);
      return id;
    },
    list_volumes: () => JSON.parse(JSON.stringify(volumes)),
    remove_volumes: (a) => {
      const r = a.names.map((name) => {
        const i = volumes.findIndex((v) => v.name === name);
        if (i < 0) return { id: name, error: "No such volume" };
        volumes.splice(i, 1);
        return { id: name, error: null };
      });
      setTimeout(() => window.__engine({ type: "changed", resource: "volume", action: "destroy", id: "" }), 10);
      return r;
    },
    list_networks: () => JSON.parse(JSON.stringify(networks)),
    remove_networks: (a) => {
      const r = a.ids.map((id) => {
        const i = networks.findIndex((x) => x.id === id);
        if (i < 0) return { id, error: "No such network" };
        networks.splice(i, 1);
        return { id, error: null };
      });
      setTimeout(() => window.__engine({ type: "changed", resource: "network", action: "destroy", id: "" }), 10);
      return r;
    },
    wsl_distros: () => [
      { name: "Ubuntu-Dev", default: true, running: true, version: 2 },
      { name: "Ubuntu", default: false, running: false, version: 2 },
    ],
    compose_pinned: () => pinned,
    compose_pin: (a) => {
      const name = a.file.split(/[\\/]/).slice(-2, -1)[0].toLowerCase();
      pinned = [...pinned.filter((p) => p.name !== name), { name, file: a.file }];
      return pinned;
    },
    compose_unpin: (a) => (pinned = pinned.filter((p) => p.name !== a.name)),
    compose_check: () => ({ code: 0, stdout: "Docker Compose version v2.40.3\n", stderr: "" }),
    save_text_file: () => null,
    compose_run: (a) => {
      const id = ++streamId;
      const project = a.target.name;
      const lines = {
        up: [`[+] Running 3/3`, ` ✔ Network ${project}_default  Created`, ` ✔ Container ${project}-db-1   Started`, ` ✔ Container ${project}-web-1  Started`],
        down: [`[+] Running 3/3`, ` ✔ Container ${project}-web-1  Removed`, ` ✔ Network ${project}_default  Removed`],
        restart: [` ✔ Container ${project}-web-1  Started`],
        stop: [` ✔ Container ${project}-web-1  Stopped`],
        pull: [` ✔ web Pulled`, ` ✔ db Pulled`],
      }[a.verb.replace("-volumes", "")] ?? [];
      send(a.onMessage, { type: "line", text: `> wsl.exe --cd ${a.target.dir} -- docker compose -p ${project} ${a.verb}`, err: false });
      let i = 0;
      timers[id] = setInterval(() => {
        if (i < lines.length) send(a.onMessage, { type: "line", text: lines[i++], err: true });
        else {
          clearInterval(timers[id]);
          if (a.verb.startsWith("down")) for (const c of containers) if (c.project === project) c.state = "exited";
          send(a.onMessage, { type: "exit", code: 0, error: null });
          window.__engine({ type: "changed", resource: "container", action: a.verb, id: "" });
        }
      }, 120);
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
