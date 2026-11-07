# Changelog

## Unreleased

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
