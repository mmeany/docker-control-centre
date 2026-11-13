// Containers: the list, a project, a container and its children.
const ACTIONS = `- **Start**, **Stop**, **Restart**, **Pause** / **Unpause** and **Kill** act on the selected containers. Only the verbs that suit their state are offered.
- **Delete** (Del) asks first. Running containers are stopped first, named volumes are kept, and you can tick to delete their anonymous volumes too.
- Selecting a project stands for all of its containers.`;

export const containersTopics = {
  "containers.list.explorer": {
    title: "Containers",
    body: `Compose projects, each a folder of its containers, and then standalone containers. Each has a mark for its state; a project's mark sums up its containers (partly running is amber).

${ACTIONS}

Open a project or a container with Enter or a double-click. Right-click for the same commands, **Open in new tab**, **Open in new window** and copying a name or ID.

**Show** above the tree decides how much of this the tree lists (running only by default). This list always shows everything.`,
  },
  "containers.list.dashboard": {
    title: "Containers",
    body: `Compose projects, with their containers under them, then standalone containers. Each has a mark for its state; a project's mark sums up its containers (partly running is amber).

- Each row has **Start** or **Stop**, **Restart** and **Logs**; the rest (pause, kill, delete and more) is under **More**.
- Click the arrow beside a project to show or hide its containers.
- Tick rows, or Ctrl+click them, for a bar that acts on all of them. Esc clears the selection.
- **Delete** (Del) asks first. Selecting a project stands for all of its containers.

Click a name, or double-click a row, to open it. **Details** in the header shows the selected container's properties.`,
  },
  "containers.project.explorer": {
    title: "Compose project's containers",
    body: `The containers of one compose project, by service.

${ACTIONS}

Open a container with Enter or a double-click. The project's compose actions (up, down, pull, its merged logs and compose file) are in the **Compose** section: the address \`/compose/<project>\`.`,
  },
  "containers.project.dashboard": {
    title: "Compose project's containers",
    body: `The containers of one compose project.

- Each row has **Start** or **Stop**, **Restart** and **Logs**; the rest is under **More**.
- Tick rows, or Ctrl+click them, for a bar that acts on all of them. Esc clears the selection.
- **Delete** (Del) asks first.

The project's compose actions (up, down, pull, its merged logs and compose file) are in the **Compose** section.`,
  },
  "containers.container": {
    title: "Container",
    body: `What you can open for this container:

| Item | Shows |
|---|---|
| Logs | Its output, live |
| Terminal | A shell inside it |
| Stats | CPU, memory, network and disk use, live |
| Files | Its file system: browse, copy out, copy in |
| Environment, Mounts, Ports, Networks, Labels | How it's set up |

The command bar acts on the container itself: start, stop, restart, pause, kill and delete. The status bar shows its image and state, and the details pane its main properties.`,
  },
  "containers.logs": {
    title: "Logs",
    body: `The container's output (stdout and stderr), following new lines as they're written.

- **Range:** the last 1,000 lines, the last 15 minutes, hour or 24 hours, everything, or a custom range. Long ranges keep the newest lines and say how many older ones were dropped.
- **Find:** highlights matches; Enter goes to the next one and Shift+Enter to the previous one. Esc clears it.
- **Timestamps:** shows when each line was written.
- **Follow:** keeps adding new lines. Untick it to read the range without it moving.
- **Export…** saves the range to a file.
- **Pop out** opens the logs in their own window.

If the container isn't running, new lines appear when it starts.`,
  },
  "containers.terminal": {
    title: "Terminal",
    body: `A shell inside the running container: bash if it has it, otherwise sh. It's the same as \`docker exec -it <container> bash\`.

- Every key goes to the shell, including Ctrl+W, Ctrl+L and Ctrl+C. The only exception is F1, which shows this help.
- When the shell exits, **Reconnect** starts a new one.
- **Pop out** opens the terminal in its own window.

A stopped container has no terminal: start it first. Images with no shell at all (distroless, scratch) can't open one; **Files** still works for them.`,
  },
  "containers.stats": {
    title: "Stats",
    body: `Live use by this container, about once a second, with the last two minutes as a graph:

- **CPU:** 100% is one core, so a container using two whole cores shows 200%.
- **Memory:** in use, and the limit if it has one.
- **Network in / out** and **Disk read / write:** per second, and the total since it started.
- **Processes:** how many it's running.

The stats stop while you're elsewhere and start again when you come back. **Pop out** opens them in their own window, to keep watching while you work.`,
  },
  "containers.files": {
    title: "Files",
    body: `The container's file system, a folder at a time. Open a folder with Enter or a double-click, and go up with Backspace. Each folder has its own address, so you can type one such as \`…/files/etc/nginx\`.

- **Copy out…** saves the selected file on this computer, or a folder as a .tar archive.
- **Copy a file in…** / **Copy a folder in…** copy from this computer into the folder shown. Existing files with the same names are replaced.
- **Drag** files or folders from File Explorer onto the list to copy them in.

Running containers with a shell are listed with \`stat\`, so you see owners and permissions. Stopped containers, and images with no shell, are read from an archive of the folder instead; that's slower for big folders and is capped at 64 MB.`,
  },
  "containers.details": {
    title: "Container details",
    body: `How the container is set up, as Docker reports it:

- **Environment:** its variables. Values whose names look secret (password, token, key, …) are hidden until you click **Reveal**; **Copy** copies one without showing it.
- **Mounts:** volumes and bind mounts, where they're mounted and whether they're read-only. Anonymous volumes (Docker made them because nothing named a volume at that path) say why in **Unnamed**: an image \`VOLUME\` nothing is mounted over, or a volume asked for with no name (\`-v /path\`, or \`- /path\` in a compose file). Hover over it for more.
- **Ports:** published ports (reachable from this computer) and exposed ones. A container that isn't running publishes nothing, so this shows what it publishes when it starts; lists show those ports faded.
- **Networks:** the networks it's on, with its address on each.
- **Labels:** its labels, including compose's own (\`com.docker.compose.*\`).

Drag a heading's right edge to resize a column, or double-click the edge to fit it; right-click the headings for **Reset column widths**. Widths are shared by every container's table of that kind.

These are read-only. To change them, change the compose file or the command that created the container and recreate it.`,
  },
};
