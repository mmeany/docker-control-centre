# Docker Control Centre — build plan

A Windows-first Tauri v2 desktop app for managing a Docker engine, using the Windows 11 File Explorer interaction model throughout.

## Decisions

| Area | Decision |
|---|---|
| Scaffold | `scaffold-tauri-app` skill (mmeany/tauri-desktop-template), then reshape to the CLAUDE.md layout |
| Navigation | Faithful Explorer: path-addressable locations, per-tab back/forward/up history, typed paths in the address bar |
| Engine | One engine via `bollard`, from `DOCKER_HOST`, falling back to `tcp://localhost:2375`; the engine is still the path root so multi-engine can come later |
| Opening an item | Double-click navigates *into* it (containers, projects, images, volumes and networks are all folders) |
| v1 scope | Containers, logs, exec terminal, stats, images/volumes/networks, Compose, container Files |
| Compose discovery | `com.docker.compose.*` labels plus manually pinned compose files (Windows path stored, WSL path derived) |
| Compose execution | `ComposeRunner` trait: `WslRunner` (default on Windows) and `HostRunner` (macOS/Linux) |
| Platforms | Windows first; macOS/Linux build but get no polish |
| Destructive actions | Explorer-style confirm dialog listing targets; prune shows a dry-run preview; removing a volume needs an explicit extra tick; no "don't ask again" |
| Files listing | exec busybox-compatible `ls`/`stat`, falling back to the archive API (capped) when the image has no shell; copy in/out uses the archive API |
| Logs | Follow, search/highlight, timestamps, stdout/stderr colouring, merged Compose project logs, since/until, export, pop-out window |
| Keyboard | Explorer shortcuts; no command palette in v1 |
| Session | Restore tabs, locations, view mode per location, window geometry |
| Testing | Rust unit tests behind a `DockerApi` trait (mockall); engine integration tests behind a `integration` feature; Vitest + Testing Library |
| Distribution | Public GitHub repo, GitHub Actions builds unsigned MSI/NSIS for each release, licensed MIT OR Apache-2.0 |

## Adjusted to the template (M1)

Where the template's conventions differ from the first draft of this plan,
the template wins (CLAUDE.md is the source of truth for code):

- **No extra frontend libraries.** No Zustand, TanStack Query/Virtual or
  `ts-rs`. Tabs and history are plain React state (`state/tabs.ts`), engine
  data is loaded per section and reloaded from the change feed, `FileList` is
  already virtualised, and DTO types are written by hand in `src/api/`.
- **Settings** use the template's `settings.json` store (`values`), not
  `tauri-plugin-store` / `tauri-plugin-window-state`.
- **Tabs live in the first toolbar row**, under the native title bar, rather
  than in a custom title bar (which avoids the Snap layouts risk).
- **Testing:** instead of a mockable `DockerApi` trait, mapping from bollard
  models is pure functions with unit tests, plus `--features integration`
  tests against the real engine. Vitest covers the path, address and tab
  logic, and `npm run ui:check` drives the UI with the IPC mocked.
- **Container paths** are `@project/name/child`, e.g.
  `/containers/@shop/shop-web-1/logs`; standalone containers have no
  `@project` segment. The sections below are the original draft.

## Location model (the backbone)

Every view is a `Location`, serialised as a path and rendered by the address bar as breadcrumbs.

```
/                                   engine root  (shows: Containers, Images, Volumes, Networks, Compose)
/containers                         all containers, grouped by project
/containers/<id-or-name>            container "folder" → Logs, Terminal, Stats, Files, Env, Mounts, Ports, Networks, Labels
/containers/<c>/logs
/containers/<c>/terminal
/containers/<c>/stats
/containers/<c>/files/<path...>
/containers/<c>/env | mounts | ports | networks | labels
/compose                            projects (running + pinned)
/compose/<project>                  services/containers + Logs (merged), compose file
/images[/<id>[/layers|history|containers]]
/volumes[/<name>[/containers]]
/networks[/<name>[/containers]]
```

- Frontend: `Location` is a discriminated union in TS, with `parse(path)` / `format(loc)` round-tripping (unit-tested). The display path uses the engine label (`Ubuntu-Dev › Containers › shop`). Typed input accepts either form.
- Each tab owns `{ history: Location[], index, viewMode, selection, sort }`. The tab state lives in a Zustand store and is persisted through the Rust settings layer.
- `FileList` renders any location that yields items; leaf locations (logs, terminal, stats) render a viewer in the content area instead.

## Architecture

### Rust (`src-tauri`)
- `state.rs` holds an `AppState` with `Arc<dyn DockerApi>` (a trait wrapping `bollard::Docker`, which makes mocking possible), `Settings`, and a `StreamRegistry` (`HashMap<StreamId, AbortHandle>`) so the frontend can cancel streams.
- `commands/*` are thin `#[tauri::command]`s that return serde DTOs. They never return bollard types directly; DTOs carry only what the UI needs and are generated to TS with `ts-rs` (or `specta`).
- `streams/*` handle the long-lived work. Each one starts a tokio task that forwards over a Tauri `Channel<T>`, registers itself in `StreamRegistry`, and stops when `stop_stream(id)` is called or the window closes.
  - `events.rs` keeps a single engine event subscription and emits `docker://event`. Lists update from events plus targeted re-fetches, not polling.
  - `logs.rs` handles single-container logs and merged project logs: it fans in N log streams, tags each line with its service, and orders by timestamp.
  - `stats.rs` streams container stats and computes CPU % and memory on the Rust side.
  - Exec/terminal uses bollard `create_exec` + `start_exec` (attached, tty). stdin goes over a command, stdout over a channel, and resize uses `resize_exec`. This works over TCP 2375 because the connection is hijacked.
- `commands/compose.rs`
  - `ComposeRunner::run(project_dir, files, args) -> stream of output lines + exit code`.
  - `WslRunner` runs `wsl.exe -d <distro> --cd <wsl_dir> -- docker compose -f … <args>`. It converts paths in Rust (`E:\x` → `/mnt/e/x`) and keeps `wslpath` as a fallback for odd mounts. The distro comes from settings; the default is the WSL default distro (`wsl -l -v` parsing for the picker).
  - `HostRunner` runs `docker compose …` directly.
  - Supported operations: up -d, down (optionally -v), restart, pull, ps, config (to validate pinned files).
- Files: `exec` `ls -la --full-time`, parsed with tolerance for busybox and GNU output. If exec fails because there's no shell, it falls back to `GET /containers/{id}/archive` with a byte cap. Copying uses archive GET/PUT, and pre-flight uses `HEAD archive` (stat).
- Settings live in a JSON file in the app config dir through `tauri-plugin-store`. They hold the engine URL override, compose mode (WSL/host), WSL distro, pinned compose files, the restored session, and window state (`tauri-plugin-window-state`).

### Frontend (`src`)
- React + TS + Vite (template defaults), Zustand for tab/session state, and TanStack Query for engine data. Docker events invalidate the matching query keys.
- Components follow CLAUDE.md: `TitleBarTabs` (custom title bar with `decorations: false` and drag regions), `NavPane` (tree driven by locations), `AddressBar` (breadcrumbs ↔ edit mode), `CommandBar` (actions depend on the location and the selection), `FileList` (details/list/tiles, virtualised with TanStack Virtual), `DetailsPane`, `StatusBar`, `ContextMenu`, and `Terminal` (xterm.js plus the fit and search addons).
- Logs viewer: virtualised line buffer with a cap (for example 50k lines), search highlighting, a timestamp toggle, service colouring, and since/until pickers. Export goes through `tauri-plugin-dialog` + `fs`.
- Pop-out: a new `WebviewWindow` opened at a location URL, so the same router renders a single view.
- Destructive flows: one `ConfirmDialog` component that takes the list of targets. Prune calls the backend's dry-run (which lists the candidates) before it executes.

## Milestones

Each milestone ends in something runnable and tested.

1. **Scaffold and Explorer shell.** Run the template, reshape to the CLAUDE.md layout, set up the licence and CI lint/test workflow. Then build the custom title bar with tabs, the location model and router, per-tab history, the address bar (breadcrumbs plus typed paths), the nav pane, and the status bar. Add the `DockerApi` trait, the connection from `DOCKER_HOST`, and a status bar connection indicator. Finish with the containers list (details view) and live updates from the events stream.
2. **Container actions.** Command bar and context menu: start/stop/restart/pause/kill/remove with confirm dialogs, multi-select, and Explorer shortcuts. Add list/tiles views, sorting, the details pane, and inspect sections (env, mounts, ports, networks, labels) as child locations. Add session restore.
3. **Logs, terminal and stats.** Logs viewer (follow, search, timestamps, since/until, export), exec terminal, stats graphs, and pop-out windows.
4. **Images, volumes and networks.** Lists, inspect children, remove, prune with a dry-run preview, image pull with progress, and cross-links (image → containers using it).
5. **Compose.** Label discovery, pinned files, the settings UI (WSL toggle and distro picker), `WslRunner`/`HostRunner`, up/down/restart/pull with streamed output, and merged project logs.
6. **Files.** Directory browsing via exec with the archive fallback, copy in/out (drag and drop from Windows Explorer if feasible), and breadcrumb navigation inside the container FS.
7. **Release.** GitHub Actions matrix build (Windows MSI/NSIS required, macOS/Linux best-effort), release on tag, README with screenshots, and docs for the WSL setup.

## Risks and open points

- **Unauthenticated TCP 2375.** This is fine for localhost on your machine, but the README must warn about it. A TLS/named-pipe option fits the later multi-engine work.
- **Custom title bar on Windows.** Snap layouts and the maximise-button hover need care with `decorations: false`. Check what the template already does.
- **WSL path conversion** for UNC paths (`\\wsl$\...`) and for drives not mounted under `/mnt`. Fall back to `wslpath -u`.
- **Merged log ordering** depends on timestamps, so request `timestamps=true` from the engine and strip them for display when the toggle is off.
- **Files on huge directories** are slow through the archive fallback. The cap and a "directory too large to list without a shell" message are the mitigation.
