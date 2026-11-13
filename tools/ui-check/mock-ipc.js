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
    { name: "legacy_db", driver: "local", mountpoint: "/var/lib/docker/volumes/legacy_db/_data", created: iso(4000), scope: "local", anonymous: false, project: "legacy", labels: [{ key: "com.docker.compose.project", value: "legacy" }], options: [] },
    { name: "old_cache", driver: "local", mountpoint: "/var/lib/docker/volumes/old_cache/_data", created: iso(2000), scope: "local", anonymous: false, project: null, labels: [], options: [] },
    { name: hex(5), driver: "local", mountpoint: "/var/lib/docker/volumes/x/_data", created: iso(500), scope: "local", anonymous: true, project: null, labels: [], options: [] },
    // Nginx's cache, made by an image VOLUME in shop's web service.
    { name: hex(7), driver: "local", mountpoint: `/var/lib/docker/volumes/${hex(7)}/_data`, created: iso(3), scope: "local", anonymous: true, project: "shop", labels: [{ key: "com.docker.volume.anonymous", value: "" }, { key: "com.docker.compose.project", value: "shop" }], options: [] },
    // Postgres's image VOLUME, mounted by the plain postgres container.
    { name: hex(6), driver: "local", mountpoint: `/var/lib/docker/volumes/${hex(6)}/_data`, created: iso(130), scope: "local", anonymous: true, project: null, labels: [{ key: "com.docker.volume.anonymous", value: "" }], options: [] },
  ];
  const network = (name, subnet, opts = {}) => ({ id: hex(name.length * 3), name, driver: opts.driver ?? "bridge", scope: "local", created: iso(800), internal: false, attachable: false, ipv6: false, subnets: subnet ? [subnet] : [], gateways: subnet ? [subnet.replace(/0\/16$/, "1")] : [], builtin: !!opts.builtin, project: opts.project ?? null, labels: [], options: [] });
  const networks = [
    network("bridge", "172.17.0.0/16", { builtin: true }),
    network("host", null, { builtin: true, driver: "host" }),
    network("none", null, { builtin: true, driver: "null" }),
    network("shop_default", "172.18.0.0/16", { project: "shop" }),
    network("monitoring_default", "172.19.0.0/16", { project: "monitoring" }),
    network("old_default", "172.20.0.0/16"),
    network("legacy_default", "172.21.0.0/16", { project: "legacy" }),
  ];
  const container = (name, image, state, status, opts = {}) => ({
    id: (++n).toString(16).padStart(4, "0").repeat(16),
    name,
    image,
    state,
    status,
    created: iso(opts.age ?? 30),
    ports: opts.ports ?? [],
    configuredPorts: opts.configuredPorts ?? [],
    project: opts.project ?? null,
    service: opts.service ?? null,
    workingDir: opts.project ? `/home/mark/projects/${opts.project}` : null,
    configFiles: opts.project
      ? [`/home/mark/projects/${opts.project}/compose.yml`, ...(opts.project === "shop" ? ["/home/mark/projects/shop/compose.override.yml"] : [])]
      : [],
    imageId: imageIdOf(image),
    exitCode: /^Exited \((\d+)\)/.test(status) ? Number(/^Exited \((\d+)\)/.exec(status)[1]) : null,
    health: opts.health ?? "",
    volumes: opts.volumes ?? [],
    volumeMounts: (opts.volumes ?? []).map((name) => ({ name, destination: opts.mountAt?.[name] ?? "/data" })),
    networks: opts.project ? [`${opts.project}_default`] : ["bridge"],
  });
  const containers = [
    container("shop-web-1", "nginx:1.27", "running", "Up 3 hours", { project: "shop", service: "web", ports: ["8080→80/tcp"], volumes: [hex(7)], mountAt: { [hex(7)]: "/var/cache/nginx" } }),
    container("shop-api-1", "shop-api:latest", "running", "Up 3 hours", { project: "shop", service: "api", ports: ["3000→3000/tcp"], volumes: ["shop_pgdata"] }),
    container("shop-worker-1", "shop-api:latest", "exited", "Exited (0) 2 hours ago", { project: "shop", service: "worker", configuredPorts: ["9100→9100/tcp"] }),
    container("monitoring-prometheus-1", "prom/prometheus:v3.1.0", "running", "Up 2 days", { project: "monitoring", service: "prometheus", ports: ["9090→9090/tcp"], age: 60, volumes: ["monitoring_prom"] }),
    container("monitoring-grafana-1", "grafana/grafana:11.4.0", "paused", "Up 2 days (Paused)", { project: "monitoring", service: "grafana", ports: ["3001→3000/tcp"], age: 60 }),
    container("postgres", "postgres:17", "running", "Up 5 days (healthy)", { ports: ["5432→5432/tcp"], age: 130, health: "healthy", volumes: [hex(6)], mountAt: { [hex(6)]: "/var/lib/postgresql/data" } }),
    container("api-canary", "shop-api:latest", "running", "Up 2 hours (unhealthy)", { ports: ["3100→3000/tcp"], age: 3, health: "unhealthy" }),
    container("redis-scratch", "redis:7.4", "exited", "Exited (137) 3 days ago", { age: 80 }),
  ];

  const settings = { theme: window.__UI_CHECK_THEME__ || "dark", filterHistory: {}, values: {} };
  let engineChannel = null;
  let engineIndex = 0;
  let streamId = 0;
  const fe = (name, kind, size = 0, mode = kind === "dir" ? "drwxr-xr-x" : "-rw-r--r--") => ({ name, kind, size, modified: iso(50), mode });
  const cfs = {
    "/": [fe("bin", "linkDir", 7, "lrwxrwxrwx"), fe("etc", "dir"), fe("tmp", "dir"), fe("usr", "dir"), fe("var", "dir"), fe(".dockerenv", "file")],
    "/etc": [fe("nginx", "dir"), fe("hosts", "file", 174), fe("hostname", "file", 13), fe("os-release", "file", 267), fe("passwd", "file", 922)],
    "/etc/nginx": [fe("conf.d", "dir"), fe("nginx.conf", "file", 648), fe("mime.types", "file", 5349)],
    "/etc/nginx/conf.d": [fe("default.conf", "file", 1093)],
    "/tmp": [],
    "/usr": [],
    "/var": [],
  };
  let pinned = [{ name: "blog", files: ["E:\\projects\\blog\\compose.yml"] }];
  /** The project compose would name a file's folder. */
  const folderName = (file) => file.split(/[\\/]/).slice(-2, -1)[0].toLowerCase();
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
    about_info: () => ({ name: "Docker Control Centre", version: window.__APP_VERSION__ || "unknown", projectUrl: "https://github.com/mmeany/docker-control-centre" }),
    open_project_page: () => null,
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
      // Not running: the configured bindings, as the engine's inspect has them.
      const [port, host] = (c.ports[0] || c.configuredPorts[0] || "").split("→").reverse();
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
        mounts: [
          ...(c.project ? [{ kind: "bind", name: "", source: `${c.workingDir}/data`, destination: "/data", mode: "rw", readWrite: true, anonymous: null }] : []),
          ...c.volumeMounts.map((m) => ({
            kind: "volume",
            name: m.name,
            source: `/var/lib/docker/volumes/${m.name}/_data`,
            destination: m.destination,
            mode: "z",
            readWrite: true,
            anonymous: /^[0-9a-f]{64}$/.test(m.name) ? (/^(postgres|nginx)/.test(c.image) ? "image" : "noSource") : null,
          })),
        ],
        ports: port ? [{ containerPort: port, host: host ? [`0.0.0.0:${host}`, ...(c.ports.length ? [`[::]:${host}`] : [])] : [] }] : [],
        portsConfigured: !c.ports.length && c.configuredPorts.length > 0,
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
        else if (t === "start" || t === "restart" || t === "unpause") Object.assign(c, { state: "running", status: "Up 1 second", exitCode: null, health: "" });
        else if (t === "pause") Object.assign(c, { state: "paused", status: "Up 3 hours (Paused)" });
        else Object.assign(c, { state: "exited", status: `Exited (${t === "kill" ? 137 : 0}) 1 second ago`, exitCode: t === "kill" ? 137 : 0, health: "" });
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
    // Engine-wide totals: the running containers' figures, summed (window.__totalsSkipped
    // pretends the cap left some out). Ticks faster than Rust's 2 s to keep checks quick.
    stream_stats_totals: (a) => {
      const id = ++streamId;
      let k = 0;
      const tick = () => {
        k++;
        const list = containers
          .filter((c) => c.state === "running")
          .map((c, i) => ({
            id: c.id,
            name: c.name,
            cpuPercent: Math.max(0, 8 + 14 * i + 6 * Math.sin(k / 2 + i)),
            memUsed: (60 + 45 * i) * 1e6,
            memLimit: 16e9,
            netRxRate: 12_000 + 3_000 * i,
            netTxRate: 4_000 + 1_000 * i,
            blockReadRate: 0,
            blockWriteRate: 2_048 * (i + 1),
          }))
          .sort((x, y) => y.cpuPercent - x.cpuPercent);
        const sum = (f) => list.reduce((t, c) => t + c[f], 0);
        send(a.onMessage, {
          type: "totals",
          cpuPercent: sum("cpuPercent"),
          onlineCpus: 8,
          memUsed: sum("memUsed"),
          memLimit: 16e9,
          netRxRate: sum("netRxRate"),
          netTxRate: sum("netTxRate"),
          blockReadRate: sum("blockReadRate"),
          blockWriteRate: sum("blockWriteRate"),
          counted: list.length,
          skipped: window.__totalsSkipped ?? 0,
          containers: list,
        });
      };
      tick();
      timers[id] = setInterval(tick, 500);
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
    // A small file system shared by every container; stopped ones list via the archive.
    list_container_dir: (a) => {
      const entries = cfs[a.path];
      if (!entries) throw { kind: "notFound", message: `${a.path} doesn't exist.`, detail: "" };
      return { path: a.path, entries, method: a.running ? "exec" : "archive", truncated: false };
    },
    copy_from_container: (a) => ({ savedAs: (cfs[a.path] ? "tar" : "file"), bytes: 1234 }),
    copy_into_container: (a) => {
      const now = new Date().toISOString();
      for (const s of a.sources) {
        const name = s.split(/[\\/]/).pop();
        (cfs[a.dir] = cfs[a.dir] || []).push({ name, kind: "file", size: 42, modified: now, mode: "-rw-r--r--" });
      }
      return a.sources.length;
    },
    wsl_distros: () => [
      { name: "Ubuntu-Dev", default: true, running: true, version: 2 },
      { name: "Ubuntu", default: false, running: false, version: 2 },
    ],
    compose_pinned: () => pinned,
    compose_pin: (a) => {
      const name = folderName(a.files[0]);
      pinned = [...pinned.filter((p) => p.name !== name), { name, files: a.files }].sort((x, y) => x.name.localeCompare(y.name));
      return pinned;
    },
    compose_project_name: (a) => {
      if (a.files.some((f) => f.includes("broken"))) throw { kind: "invalid", message: `Compose couldn't read these ${a.files.length} files: yaml: line 1: did not find expected node content`, detail: "" };
      return folderName(a.files[0]);
    },
    // A .yml is a dropped file (an override sits beside a base file); a path
    // with "nas" is a network share WSL can't reach, one with "Debian" is in
    // another WSL distro; another name with an
    // extension isn't compose; anything else is a folder holding a base file,
    // its override and two variants.
    compose_drop_candidates: (a) => {
      const groups = [];
      const files = {};
      for (const p of a.paths) {
        if (/\.ya?ml$/i.test(p)) {
          const dir = p.slice(0, Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/")));
          (files[dir] = files[dir] || []).push(p);
        } else if (p.includes("nas")) groups.push({ dir: p, candidates: [], error: `WSL can't open ${p}. Compose runs in WSL (Settings), which reaches local drives and WSL folders, not network shares.` });
        else if (p.includes("Debian")) groups.push({ dir: p, candidates: [], error: `${p} is in Debian, but compose runs in Ubuntu-Dev (Settings).` });
        else if (/\.\w+$/.test(p)) continue;
        else
          groups.push({
            dir: p,
            error: null,
            candidates: [
              { path: `${p}\\compose.yml`, role: "base", ticked: true },
              { path: `${p}\\compose.override.yml`, role: "override", ticked: true },
              { path: `${p}\\compose-broken.yml`, role: "variant", ticked: false },
              { path: `${p}\\compose-dev.yml`, role: "variant", ticked: false },
            ],
          });
      }
      for (const [dir, list] of Object.entries(files)) {
        const base = list.find((f) => /[\\/](docker-)?compose\.ya?ml$/i.test(f));
        const cands = list.map((f) => ({ path: f, role: f === base ? "base" : "variant", ticked: true }));
        if (base) cands.splice(1, 0, { path: `${dir}\\compose.override.yml`, role: "override", ticked: true });
        groups.push({ dir, candidates: cands, error: null });
      }
      if (groups.length === 0) throw { kind: "invalid", message: "Drop a compose file (.yml or .yaml), or a folder with one.", detail: "" };
      return groups;
    },
    compose_unpin: (a) => (pinned = pinned.filter((p) => p.name !== a.name)),
    compose_check: (a) =>
      a.verb === "config-yaml"
        ? { code: 0, stdout: `name: ${a.target.name}\nservices:\n  api:\n    environment:\n      DB_PASSWORD: s3cret-from-env\n    image: node:22-bookworm-slim\n`, stderr: "" }
        : { code: 0, stdout: "Docker Compose version v2.40.3\n", stderr: "" },
    // The pinned blog's file has gone, to show the error.
    compose_read_file: (a) => {
      if (a.path.includes("blog")) throw { kind: "notFound", message: `${a.path} doesn't exist.`, detail: "" };
      const local = a.path.startsWith("/") ? "\\\\wsl.localhost\\Ubuntu-Dev" + a.path.split("/").join("\\") : a.path;
      const text = a.path.endsWith("override.yml")
        ? 'services:\n  api:\n    ports:\n      - "3000:3000" # dev only\n'
        : '# Shop: web, api and a worker\nservices:\n  web:\n    image: nginx:1.27\n    ports:\n      - "8080:80"\n  api:\n    image: node:22-bookworm-slim\n    environment:\n      DB_PASSWORD: ${DB_PASSWORD}\n  worker:\n    image: node:22-bookworm-slim\n    command: ["node", "worker.js"]\n';
      return { path: local, text, size: text.length };
    },
    compose_show_file: () => null,
    // Shop: nginx's cache (an image VOLUME, held now) and the worker's
    // /tmp/cache (no name, not made yet). Monitoring: grafana isn't pulled.
    compose_unnamed_volumes: (a) => {
      const project = a.target.name ?? "";
      const findings =
        project === "shop"
          ? [
              { service: "web", target: "/var/cache/nginx", cause: "image", current: [{ container: "shop-web-1", volume: hex(7) }], key: "web-nginx", name: "shop-web-nginx" },
              { service: "worker", target: "/tmp/cache", cause: "noSource", current: [], key: "worker-cache", name: "shop-worker-cache" },
            ]
          : [];
      const unchecked = project === "monitoring" ? [{ service: "grafana", image: "grafana/grafana:11.4.0", build: false }] : [];
      return { project, findings, unchecked, configError: null };
    },
    // A small stand-in for Rust's editor: web's volume goes in compose.yml;
    // the worker is left to do by hand (as if it merged settings with <<:).
    compose_name_volumes: (a) => {
      const files = a.target.files.map((path) => handlers.compose_read_file({ path }));
      const valid = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
      const issues = [];
      a.volumes.forEach((v, index) => {
        if (!valid.test(v.key)) issues.push({ index, field: "key", message: "Use letters, digits, _ . or -, starting with a letter or digit." });
        if (!valid.test(v.name)) issues.push({ index, field: "name", message: "Use letters, digits, _ . or -, starting with a letter or digit." });
        else if (volumes.some((x) => x.name === v.name)) issues.push({ index, field: "name", message: `A volume called ${v.name} already exists.` });
      });
      const manual = [];
      const revised = files.map((f) => f.text);
      const top = [];
      for (const v of a.volumes) {
        if (v.service === "web" && files[0]) {
          revised[0] = revised[0].replace('      - "8080:80"\n', `      - "8080:80"\n    volumes:\n      - ${v.key}:${v.target}\n`);
          top.push(`  ${v.key}:\n    name: ${v.name}\n`);
        } else
          manual.push({
            service: v.service,
            target: v.target,
            reason: "The service merges settings from elsewhere (<<:).",
            snippet: `services:\n  ${v.service}:\n    volumes:\n      - ${v.key}:${v.target}\nvolumes:\n  ${v.key}:\n    name: ${v.name}\n`,
          });
      }
      if (top.length) revised[0] += `\nvolumes:\n${top.join("")}`;
      return {
        files: files.map((f, i) => ({ path: f.path, original: f.text, revised: revised[i], changed: revised[i] !== f.text, backupExists: false })),
        manual,
        issues,
      };
    },
    compose_save_revision: () => null,
    // The move's steps, as Rust reports them, then a clean exit.
    compose_move_volumes: (a) => {
      const id = ++streamId;
      const project = a.target.name;
      const lines = [
        ...a.files.map((f) => `Saved ${f.path} (the old one is in compose.yml.bak)`),
        "> docker compose stop",
        ` ✔ Container ${project}-web-1  Stopped`,
        ...a.moves.flatMap((m) => [`Made volume ${m.name}`, `Copying ${m.from.slice(0, 12)}… into ${m.name}`]),
        "> docker compose up",
        ` ✔ Container ${project}-web-1  Started`,
        `Done: ${project} is up on its named volumes. The old unnamed volumes are kept; nothing mounts them now, so they show as orphaned and Prune can remove them.`,
      ];
      let i = 0;
      timers[id] = setInterval(() => {
        if (i < lines.length) send(a.onMessage, { type: "line", text: lines[i++], err: false });
        else {
          clearInterval(timers[id]);
          send(a.onMessage, { type: "exit", code: 0, error: null });
        }
      }, 30);
      return id;
    },
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
  /** The default handlers, for a scenario's override to wrap. */
  window.__handlers = handlers;
  window.__calls = [];
  const callbacks = {};
  let nextId = 1;
  /** Delivers a message on the engine channel, as Rust would. */
  window.__engine = (message) => engineChannel && callbacks[engineChannel.id]?.({ index: engineIndex++, message });
  // Tauri events the page listens to (drag and drop), by event name.
  const listeners = {};
  const fire = (event, payload) => (listeners[event] || []).forEach((id) => callbacks[id]?.({ event, id, payload }));
  /** Files dragged over the window from Explorer, at CSS (x, y). */
  window.__dragOver = (paths, x = 400, y = 300) => {
    fire("tauri://drag-enter", { paths, position: { x, y } });
    fire("tauri://drag-over", { paths, position: { x, y } });
  };
  window.__dragLeave = () => fire("tauri://drag-leave", null);
  /** Files dropped on the window from Explorer, as the OS would. */
  window.__drop = (paths, x = 400, y = 300) => {
    window.__dragOver(paths, x, y);
    fire("tauri://drag-drop", { paths, position: { x, y } });
  };
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
      if (cmd === "plugin:event|listen") {
        (listeners[args.event] = listeners[args.event] || []).push(args.handler);
        return args.handler;
      }
      if (cmd === "plugin:event|unlisten") {
        listeners[args.event] = (listeners[args.event] || []).filter((id) => id !== args.eventId);
        return null;
      }
      if (cmd.startsWith("plugin:event|")) return null;
      // The version from package.json, set by run.cjs or preview.html.
      if (cmd === "plugin:app|version") return window.__APP_VERSION__ || "unknown";
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
