# Docker Control Centre

A Windows-first desktop app for managing a Docker engine the way File
Explorer manages files: tabs, a tree, an address bar you can type into, and
compose projects and containers as folders. Built with Tauri 2, React and Rust.

See `CLAUDE.md` for the architecture, the rules, and how to add a section, and
`PLAN.md` for the roadmap.

## Compose and WSL

With Docker Engine in WSL, `docker compose` has to run inside WSL: the engine
resolves bind-mount paths on the Linux side. By default the app runs
`wsl.exe [-d <distro>] --cd <project folder> -- docker compose …`, converting
Windows paths (`E:\projects\shop` becomes `/mnt/e/projects/shop`). Choose the
distro, or switch to running compose on this computer (Docker Desktop), in
**Settings**; **Test** runs `docker compose version` the same way.

## Connecting to Docker

The app uses `DOCKER_HOST` when it's set (`tcp://`, `npipe://` or `unix://`),
and `tcp://localhost:2375` otherwise. That default suits Docker Engine running
in WSL with its API published on localhost.

**Security:** port 2375 is the Docker API with no authentication. Anyone who
can reach it controls the engine and, through it, the machine. Only bind it to
`localhost`, never to `0.0.0.0` on a network you don't trust.

## Sections

- **Containers:** compose projects and standalone containers. Start, stop,
  restart, pause, kill and delete them (a project stands for all of its
  containers). Open a container for live logs (search, timestamps, time
  ranges, export), a terminal (bash or sh inside it), live stats, and its
  environment, mounts, ports, networks and labels. Logs, terminal and stats
  can pop out into their own windows. Browse a container's files (even in
  images with no shell, or stopped containers), copy files out, and copy files
  or folders in (or drag them in from Explorer).
  Lists update live from the engine's events.

- **Compose:** projects that are running, plus compose files you pin so a
  project stays listed while it's down. Up, stop, restart, pull and down
  (deleting volumes needs the project name typed), with compose's output
  shown as it runs, and every service's logs merged in time order.
- **Images:** pull with per-layer progress, inspect (config, history, which
  containers use it), delete, and prune with a preview of exactly what goes.
- **Volumes:** which containers use each, delete (type the name to confirm:
  the data is gone for good), prune unused or only anonymous volumes.
- **Networks:** subnets, attached containers, delete and prune; Docker's own
  networks are left alone.

Tabs, the view chosen for each place, the details pane and the window's size
and position come back the next time you start the app.

## Prerequisites (developer machine only)

- Node.js 20+ (LTS)
- Rust (stable, MSVC toolchain on Windows) + Microsoft C++ Build Tools
- WebView2: already part of Windows 10/11

End users need none of these: the built app is a single native executable.

## Run

```
npm install
npm run tauri dev
```

The first build compiles the Rust dependencies and takes a few minutes; later
builds are incremental.

## Check the UI without the native app

```
npm i -D playwright && npx playwright install chromium   # once
npm run ui:check -- --both
```

This runs the scenarios in `tools/ui-check/scenarios` against the Vite dev
server, with the Tauri IPC mocked by `tools/ui-check/mock-ipc.js`. Screenshots
go to `tools/ui-check/out/`. The check fails on console errors or on commands
with no mock.

## Build a distributable

```
npm run tauri build
```

| Output | Use |
|---|---|
| `src-tauri\target\release\bundle\nsis\<Name>_<version>_x64-setup.exe` | Installer: Start menu entry and uninstaller; no admin rights needed by default |
| `src-tauri\target\release\bundle\msi\<Name>_<version>_x64_en-US.msi` | MSI installer, for IT / Group Policy deployment |
| `src-tauri\target\release\<slug>.exe` | The app as a single file; runs without installing |

To build only the setup program: `npm run tauri build -- --bundles nsis`.

- **Not code-signed:** Windows SmartScreen warns on first run (More info →
  Run anyway). Signing needs a certificate, configured under
  `bundle.windows` in `src-tauri/tauri.conf.json`.
- **Version:** `version` in `src-tauri/tauri.conf.json`. Raise it for each
  release so installers upgrade cleanly.
- **Before a release:** run `cargo audit` in `src-tauri`.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Enter / double-click | Open |
| Backspace, Alt+↑ | Up one level |
| Alt+← / Alt+→ | Back / forward |
| F5 | Refresh |
| Ctrl+A | Select all |
| Ctrl+T / Ctrl+W | New tab / close tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+L, Alt+D | Type an address (e.g. `/containers/@shop/shop-web-1`) |
| Middle-click a tab | Close it |
| Del | Delete the selected containers (asks first) |
| Ctrl+Shift+5 / 6 / 7 | List / details / tiles view |
| Alt+Shift+P | Show or hide the details pane |
