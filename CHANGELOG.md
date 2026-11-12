# Changelog

## Unreleased

- **Drop to start:** drag a compose file, or a folder holding one, from
  Explorer onto the window (anywhere but a container's Files, which still
  copies in) to start its project. A confirm lists the files with tick
  boxes in `-f` order: the base file and its override ticked, variants such
  as `compose-dev.yml` or `docker-compose.prod.yaml` not. It shows the
  project name compose gives them, says if compose can't read them, and
  warns when the project is already running or pinned from other files.
  Start pins the files and runs up; closing the output opens the project.
  Several folders are confirmed in turn, each after the last one's up has
  finished. Folders compose can't run (network shares, or a folder in a
  different WSL distro than compose runs in) are left out, and the first
  confirm says why. The base and override files offered are the ones
  compose itself would pick. Drops are ignored while a dialog is open and
  in pop-out windows.
- Pins hold a project's list of files (older single-file pins still load,
  and pins are still saved so 0.5.0 can read them). A pin that can't be
  read is skipped instead of emptying the list.
- **About** (Help menu) says what the app does, its version and engine, and
  links to the GitHub project, where bugs and feature requests go.

## 0.5.0 (2026-11-07)

- **Dashboard layout:** a second layout beside Explorer, chosen in Settings
  or with the Dashboard / Explorer button in either layout. It switches
  straight away, keeps the place you're on and keeps your tabs for when you
  switch back. Side navigation with section badges (collapsible), a header
  with back / forward / up and the place as a breadcrumb, a details drawer.
- **Overview:** engine-wide CPU, memory, network and disk with five minutes
  of history, the top five containers by CPU and memory, what needs
  attention (problem containers with Restart and Logs, orphans to review)
  and Compose project cards with Up and Stop. The totals come from a new
  stream (one stats stream per running container, following start and die
  events, at most 100) that runs only while the overview is open.
- **Boards:** in the dashboard, lists show containers grouped by project,
  Compose projects as cards, and images, volumes and networks as tables,
  with tick-box selection, each row's common actions as buttons, a More menu
  and a bar for acting on the selection.
- The ui-check runner takes `UI_CHECK_PORT`, and no longer leaves its Vite
  server running on Windows.

## 0.4.0 (2026-11-07)

- **Compose file:** each project has a Compose file item (beside Logs, and
  at `/compose/<project>/file`) showing the files it was started from or the
  pinned file: read-only, one tab per file, with line numbers, Copy path,
  Show in folder and Open in editor. Files inside WSL are read through
  `\\wsl.localhost\<distro>`. A Resolved tab runs `docker compose config`
  only when asked, since it fills in values from .env files, and Hide drops
  it. A file that has gone says so.
- The Containers project menu links to the Compose file, and its details
  pane lists the files.

## 0.3.0 (2026-11-06)

- **Tree filtering:** the tree shows running items and problems by default.
  **Show:** relaxes it to Running and stopped, or Everything; "+ n more"
  rows reveal a branch until it's collapsed. The open item always shows,
  badges still count everything, and the choice is remembered.

## 0.2.0 (2026-11-06)

- **Status colours:** containers, compose projects, images, volumes and
  networks are coloured by state everywhere (tree, lists, tiles, tabs,
  details pane), each state with its own mark: running / in use, starting,
  paused, restarting, partly running, problem (non-zero exit, dead,
  unhealthy), idle, stopped / unused, orphaned, down. Tooltips say why.
- Projects roll up their containers' states; section nodes count problems
  and orphans; Images, Volumes and Networks group orphans in the tree.
- Prune offers "Orphaned only" first.
- Help menu: what the colours mean, and About.

## 0.1.0 (2026-11-06)

The first version: a Windows File Explorer–style app for a Docker engine.

- **Shell:** tabs with their own back / forward history, an address bar you
  can type into (`/containers/@shop/shop-web-1/logs`), tree, details / list /
  tiles views remembered per place, details pane, Explorer shortcuts, light
  and dark themes. Tabs, views and the window come back on the next start.
- **Engine:** connects through `DOCKER_HOST` (default `tcp://localhost:2375`,
  for Docker Engine in WSL); lists update live from engine events.
- **Containers:** compose projects and standalone containers; start, stop,
  restart, pause, kill, delete; environment (secrets masked), mounts, ports,
  networks, labels.
- **Logs, terminal, stats:** live logs with search, timestamps, time ranges
  and export; a shell inside the container; CPU, memory, network and disk
  graphs. Each can pop out into its own window.
- **Files:** browse a container's folders (also stopped containers and images
  with no shell), copy out, copy in (or drag from Explorer).
- **Compose:** running and pinned projects; up, stop, restart, pull, down,
  run inside WSL (or on the host); every service's logs merged.
- **Images, volumes, networks:** inspect, see what uses what, pull with
  progress, delete, and prune with an exact preview.
