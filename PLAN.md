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

## M8: Status colours (agreed 2026-11-06)

Make it obvious at a glance whether something is running, idle, unused or
orphaned: in the tree, the lists (details, list and tiles), tab icons and the
details pane, all with the same colours and marks.

### Decisions

| Area | Decision |
|---|---|
| Style | Coloured label plus a coloured mark before the icon; stopped items muted grey |
| Shapes | Every state has its own mark as well as a colour (colour-blind safe), and a tooltip naming the state and why |
| Where | Everywhere: tree, all three list views, tab icons, details pane, Compose rows |
| Containers | Crashes look different from clean stops |
| Images, volumes, networks | One four-level scale: in use, idle, unused, orphaned |
| Orphaned colour | Orange; red is kept for errors |
| Projects | States roll up from the containers (red wins) |
| Hidden orphans | An "Orphaned (n)" folder under Images, Volumes and Networks in the tree, shown only when there are any |
| Section summaries | Count badges on section nodes, only for what needs attention |
| Legend | Tooltips everywhere, plus Help › Legend |
| Built-in networks | In use, idle or unused, never orphaned |
| Prune | Each Prune dialog leads with "Orphaned only" |

### The states

| State | Colour | Mark | Containers | Images / volumes / networks | Projects |
|---|---|---|---|---|---|
| Running / in use | green | filled dot | running (and healthy, or no health check) | a running container uses it | all running |
| Starting | amber | dot with ring | running, health check still "starting" | | |
| Paused | amber | pause bars | paused | | |
| Restarting | amber | circular arrow | restarting | | |
| Partial | amber | half dot | | | some running |
| Error | red | cross | exited with non-zero code, dead, or running but unhealthy | | any container in error (wins over everything) |
| Idle | blue | half dot | | only stopped containers use it | |
| Stopped / unused | grey (muted label) | ring | exited 0, created | nothing uses it, but it's deliberate: tagged image, named volume, a live project's network, a built-in network | all stopped |
| Orphaned | orange | warning triangle | | nothing uses it and nothing will: an untagged image no container uses; an anonymous volume nothing mounts; a volume or network labelled with a compose project that has no containers and isn't pinned | |
| Down | grey, muted | dashed ring | | | pinned, no containers |

"Error" for a container comes from the exit code in its status ("Exited
(137) …") and the health in the engine's list. Being killed for memory
(OOM) only shows on inspect; it already reads as exit 137, which is red.

### Work

1. **Status model** (`src/status/`, pure, unit-tested): `containerStatus`,
   `projectStatus` (roll-up), `imageStatus`, `volumeStatus` and
   `networkStatus` return `{ state, label, reason }`. The reason is the tooltip
   text, e.g. "Idle: only stopped containers use it (shop-worker-1)". The
   existing rules in `sections/rules.ts` (usage, prune candidates) are rebuilt
   on top of it, so the colours and what prune offers can never disagree.
2. **Data:**
   - `ContainerItem` gains `exitCode` (parsed from the status line) and
     `health` (from the list's health field), in Rust, with tests.
   - Pinned compose projects move from the Compose section into the shell
     (`shell.composePinned`), so the volume and network rules can tell "the
     project is gone" from "the project is down but pinned".
3. **Marks and colours:**
   - A `StatusMark` component draws the inline SVG mark for each state.
   - The colours become tokens with light and dark values (`--st-running`,
     `--st-idle`, `--st-unused`, `--st-orphan`, `--st-warn`, `--st-error`),
     each checked for contrast against both backgrounds.
   - `TreeRow` and FileList `Row` gain a `status` prop that colours the label
     and adds the mark, in all three views.
   - The old corner dot on container icons goes away.
4. **Tree:**
   - Project folders roll up their containers' states.
   - Section nodes get count badges, only for what needs attention, e.g.
     "Containers 2✕" in red, "Volumes 3▲" in orange.
   - Images, Volumes and Networks get an "Orphaned (n)" folder, in orange,
     when there are orphans.
5. **Elsewhere:**
   - Tab icons carry the open item's mark.
   - The details-pane header shows the mark and its reason.
   - Compose rows use the project roll-up.
   - Home shows each section's badges.
6. **Legend:** a Help button in the tab row opens a menu with Legend… (a
   dialog with every mark, colour and meaning, in both themes) and About.
7. **Prune:** each Prune dialog leads with "Orphaned only (n, size)", then
   the broader choices, using the same preview and confirmation as now.
8. **Tests and checks:**
   - Unit tests for every state and roll-up, including the edge cases: a
     built-in network is never orphaned, a pinned project keeps its volumes
     "unused" rather than orphaned, and red wins in a roll-up.
   - A `status` ui:check scenario in both themes, asserting the classes and
     tooltips in the tree, the list and tiles views, and the badges.
   - Screenshots reviewed for contrast in both themes.
   - The mock gains a crashed container, an unhealthy one, orphaned volumes
     and networks, and an idle image.

## M9: Tree filtering (agreed 2026-11-06)

By default the left tree shows only what's live, so it stays short. A Show
control relaxes it in three steps, and each branch says what it's hiding.
The main lists are not filtered.

### Decisions

| Area | Decision |
|---|---|
| Default | Running items, plus anything with a problem (a crash that just happened stays visible) |
| Non-runners | Images, volumes and networks count as running when a running container uses them; projects when any of their containers runs |
| Control | "Show:" above the tree, with three levels: Running, Running and stopped, Everything. One setting for the whole tree |
| Hint | Each branch ends with a muted "+ n more" row, e.g. "+ 3 stopped". Clicking it reveals that branch until you collapse it |
| Main lists | Not filtered: opening a section lists everything |
| Hidden but open | The open item (and its branch) shows in the tree while it's open |
| Remembered | App-wide, saved with the session; a new install starts at Running |

### Levels

Each level includes everything from the level before it.

| Level | Containers, projects | Images, volumes, networks |
|---|---|---|
| Running | running, starting, paused, restarting, partly running, problem | in use (by a running container) |
| Running and stopped | adds stopped, plus pinned projects that are down | adds idle (used only by stopped containers) |
| Everything | (nothing more) | adds unused and orphaned, and the Orphaned (n) folders |

These are defined on the M8 status states, so the filter and the colours
always agree.

### Behaviour

- **Branches:** project folders under Containers and Compose are filtered
  too. A partly running project shows its running containers and
  "+ 1 stopped".
- **Badges:** section badges (problems, orphans) always count everything, so
  hidden orphans still show as "Volumes 2▲" at the Running level.
- **Empty branches:** a section with nothing at the current level still shows
  its node, with only the "+ n more" row. When it has nothing at all, it
  shows the existing empty note ("No volumes").
- **Hint wording:** the "+ n more" row names what it hides when that's a
  single kind ("+ 3 stopped", "+ 2 orphaned"), and says "+ n more" when it
  mixes kinds.
- **Reveal:** clicking the row reveals that branch at Everything; collapsing
  the branch drops back to the global level. Reveals aren't saved.
- **Changing level:** changing the Show level clears any reveals.
- **Open item:** the open item is shown whatever the level, with its parent
  project expanded, and drops out again when you navigate away.

### Work

1. **Filter model** (`src/status/filter.ts`, pure, unit-tested):
   - `TreeLevel = "running" | "stopped" | "all"`.
   - `visibleAt(level, status)` decides whether an item shows.
   - `hiddenSummary(statuses)` produces the "+ 3 stopped" / "+ n more" text.
2. **Shell:**
   - `shell.treeLevel`, saved in settings values (`app.treeLevel`) with the
     session; the default is `running`.
   - The Show control above the tree is a small select styled like the
     theme picker, with a tooltip explaining each level.
3. **Tree:**
   - `ResourceTree`, the Containers tree and the Compose tree take the level.
     They filter their children, add the "+ n more" row, and track revealed
     branches locally.
   - The open item is always kept visible.
4. **Tests:**
   - Unit tests for the level table, including the edge cases: a problem
     container shows at Running, an orphan only at Everything, an idle image
     at Running and stopped, a down pinned project at Running and stopped.
   - A `filter` ui:check scenario in both themes. It checks the default
     view, the "+ n more" counts, revealing and collapsing a branch, each
     level, an opened hidden item, that badges are unchanged, and that the
     choice is restored after a reload.
5. **Docs:** README (the tree section), CHANGELOG (Unreleased) and
   CLAUDE.md.

## M10: Compose file (agreed 2026-11-07)

Show where a stack came from and what it says.

- A **Compose file** item in each project, beside Logs, at
  `/compose/<project>/file`. It shows the files from the containers' labels,
  or the pinned file when there is one (what the app runs against).
- Read-only, one tab per file, line numbers, YAML keys and comments
  coloured. Copy path, Show in folder, Open in editor (the default app;
  only .yml / .yaml files that exist).
- Read in Rust with a 1 MB cap; WSL paths go through
  `\\wsl.localhost\<distro>` (the chosen distro, else WSL's default).
- **Resolved** tab: `docker compose config` through the usual runner. It
  fills in values from .env files, so it runs only when asked and Hide or
  leaving drops it.
- A missing file says it may have moved or been deleted.
- Containers: the project menu links to it; the details pane lists files.

## M11: Dashboard view (agreed 2026-11-07, on a branch)

Let the user pick a dashboard layout instead of Explorer. Built on
`claude/explorer-dashboard-toggle-73dd5b` so it can be thrown away; one
commit at the end.

### Decisions

| Area | Decision |
|---|---|
| What it is | A second shell over the same sections. Section hooks, actions, confirms, dialogs and item views (logs, terminal, stats, files, inspect) are shared; only the chrome and the list views differ |
| Choosing | App-wide setting `app.layout` (`explorer` / `dashboard`) in settings values; a Layout choice in Settings plus a Dashboard / Explorer button in each layout's top bar; switches live, staying on the same place. Explorer is the default. Nothing is drawn until settings load, so Explorer never flashes first |
| Navigation | Places stay the routing model (history, pop-outs, session). No address bar or tabs on screen; a breadcrumb title instead. The dashboard drives the active tab; the other tabs are kept in the session and come back on switching to Explorer |
| Lists | `SectionUi` gains an optional `board` (card grid or roomy table with row actions) built from data the hook already loads. A section without one falls back to its `FileList` |
| Actions | Inline icon buttons per row / card for the common verbs plus an overflow menu (the context menu items); selecting several shows a bulk action bar. Verbs from the existing action rules (`containers/actions.ts` etc.), same confirmations |
| Overview | Dashboard Home: totals tiles with sparklines (CPU %, memory used / limit, network and block I/O rates, ~5 min history), top 5 by CPU and by memory, problems list (error, restarting, unhealthy, orphans) with quick actions, Compose project cards (running / total, up / stop). Explorer's Home is unchanged |
| Live totals | New aggregate stats stream. The engine has no engine-wide stats, so Rust opens one stats stream per running container, follows the change feed to add / drop them, and sends totals plus per-container figures every ~2 s. Runs only while the overview is on screen; capped at 100 containers (says so when hit). History is kept in the UI only, never persisted |
| Layout | Collapsible left nav (Overview, then the sections with badges; Settings and Help at the bottom), a header (back / forward, breadcrumb title, filter, layout toggle), details as a right drawer, status bar kept |
| Look | Roomier: 13-14px, 32-36px rows, card spacing. All colours from tokens (new tokens only with light and dark values); status colours still only from `status/status.ts`. Explorer stays 12px |
| Keyboard | Back / forward / up, F5, Del, F2, Enter, Alt+Enter, Ctrl+F and the details pane toggle work. Tab shortcuts, Ctrl+L / Alt+D and the view-mode keys do nothing |
| Pop-outs | Keep their current minimal frame in both layouts |
| Tree filtering | Not used: the dashboard has no tree. Badges count as now |

### Work

1. **Refactor, no behaviour change.** Move the shell state out of `App.tsx`
   into `useAppShell` (tabs, history, engine, Shell object, sections, keyboard,
   shared dialogs); `ExplorerLayout` renders what it returns. `ui:check`
   screenshots must match before and after.
2. **Setting and dashboard shell.** `app.layout` (`shell/layout.ts`) in the
   Settings dialog and as a button in each layout, `DashboardLayout` (nav,
   header, section command bar, drawer, status bar; nav collapse remembered
   per machine), keyboard rules above; sections fall back to their Explorer
   content, lists forced to details. Home shows section cards until step 4.
3. **Aggregate stats stream.** `src-tauri/src/stats_totals.rs` (summing,
   rates, the cap; unit-tested on samples) and `stream_stats_totals` beside
   `stream_stats`: lists running containers, then follows its own `start` /
   `die` event subscription (a container's stats stream also ends when it
   stops), refilling freed slots from those the cap skipped. Helpers are
   abort-on-drop, so `stop_stream` / closing the window ends them all. Ends
   with `{type: "end", error}` when the engine goes; `statsTotals` in
   `api/streams.ts`; mocked in ui-check; integration test with two containers.
4. **Overview.** `src/dashboard/`: `Overview.tsx` (CPU as a share of the
   engine, memory scaled to its limit, network and disk rates, five-minute
   sparklines; top 5 by CPU and memory linking to stats; problems and
   orphans with Restart / Logs / Review; project cards with Up / Stop /
   Open), `useTotals` (runs while mounted and connected), `overviewData.ts`
   (unit-tested). Quick actions go through a new optional
   `SectionUi.act(key, verb)`, so they use the section's own confirmations
   and dialogs (compose's run dialog); boards will use it too.
5. **Boards.** One shared `components/Board.tsx` renders the section's own
   FileList columns and rows as a roomy table (optionally with rows under a
   row) or as cards, with tick-box selection (the section's), inline
   actions, More (the section's context menu) and a bulk bar; loading and
   errors stay the section's. Containers: projects with their containers
   under them, Start / Stop, Restart, Logs; bulk Start / Stop / Restart /
   Delete. Compose: cards with Up / Stop / Logs (no bulk: compose runs one
   project at a time). Images, volumes, networks: Delete inline and in bulk
   (Docker's own networks disabled). Only list levels have boards; item
   pages (a container's children, a project's services, inspect views) use
   their Explorer content. Not virtualised.
6. **Checks and docs.** Mock the stream in `tools/ui-check/mock-ipc.js`,
   dashboard scenarios in both themes (overview, each board, drawer,
   switching layout keeps the place and tabs); Vitest for any new pure
   logic; README "Dashboard view" section with screenshots; CLAUDE.md (layout
   decision, code layout, `board` in Shared components); changelog.

### Open points

- 100 concurrent stats streams is a guess; measure engine load on the WSL
  engine and lower it if needed.
