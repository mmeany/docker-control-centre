// Compose: projects, a project, its merged logs and compose file, the run and drop dialogs.
const VERBS = `| Command | Runs |
|---|---|
| Up | \`docker compose up -d --remove-orphans\`: creates what's missing, recreates what changed |
| Stop / Restart | \`docker compose stop\` / \`restart\`: containers are kept |
| Pull | \`docker compose pull\`: fetches newer images (Up then uses them) |
| Down… | \`docker compose down\`: removes the containers and networks. Named volumes are kept unless you choose **Down and delete volumes…**, which needs the project name typed |`;

const WHERE = `Compose runs inside WSL or on this computer, as set in **Settings**, in the project's folder.`;

export const composeTopics = {
  "compose.list.explorer": {
    title: "Compose projects",
    body: `Projects that are running (found from their containers' labels) and projects you've pinned. **Shown because** says which.

${VERBS}

Each command opens a window with compose's output as it runs. ${WHERE}

- **Logs:** every service's logs, merged in time order.
- **File:** the compose files the project was started from.
- **Pin file…** adds a compose file, so its project stays listed while it's down. Right-click a pinned project to **Unpin** it.
- You can also drag a compose file or folder from File Explorer onto the window to pin it and bring it up.`,
  },
  "compose.list.dashboard": {
    title: "Compose projects",
    body: `A card per project: running (found from its containers' labels) or pinned, with its state, services and folder.

- Each card has **Up** or **Stop**, and **Logs**; the rest is under **More**.
- Click a card to select it: the command bar above then acts on that project, and **Details** in the header shows its folder and files.

${VERBS}

Each command opens a window with compose's output as it runs. ${WHERE}

Pin a compose file, or drag one from File Explorer onto the window, to keep its project listed while it's down.`,
  },
  "compose.project": {
    title: "Compose project",
    body: `The project's services and their containers. Open a container to see its logs, terminal, stats and files.

${VERBS}

**Logs** shows every service's logs merged, **File** the compose files the project was started from, and **Unnamed** the volumes Docker makes for it with no name. The details pane shows its folder, files, whether it's pinned and how many unnamed volumes its containers hold.

${WHERE}`,
  },
  "compose.logs": {
    title: "Project logs",
    body: `Every service's logs merged in time order, each line marked with its service.

- **Range:** the last 1,000 lines, the last 15 minutes, hour or 24 hours, everything, or a custom range.
- **Find:** Enter goes to the next match and Shift+Enter to the previous one. Esc clears it.
- **Timestamps** and **Follow** work as for one container.
- **Export…** saves the lines shown to a file.
- **Pop out** opens them in their own window.

Containers that aren't running join in when they start.`,
  },
  "compose.file": {
    title: "Compose file",
    body: `The compose files the project was started from (or that you pinned), read-only, a tab each in the order compose reads them.

- **Copy path**, **Show in folder** (File Explorer) and **Open in editor** (the app Windows uses for .yml files).
- **Resolved:** \`docker compose config\`, the files merged with variables filled in. It's only run when you click **Show resolved file**, because it can include secrets from \`.env\`. It isn't kept: **Hide** it, or leave the tab, and it's gone.

To change the project, edit its files and choose **Up** again.`,
  },
  "compose.volumes": {
    title: "Unnamed volumes",
    body: `Volumes Docker makes for the project with no name, because nothing names one at that path. They get hash names, so they're hard to find in the volumes list, and nothing says which project they belong to.

| Column | What it says |
|---|---|
| Path in container | Where the service mounts it |
| Why it's unnamed | **Image VOLUME**: the image declares the path and nothing is mounted over it. **Created without a name**: the compose file asks for a volume there with no name (\`- /path\`). Hover for more |
| Volume now | The volume each container holds now; **None yet** until Up makes one |
| Proposed name | What it would be called once named in the compose file |

The list comes from compose's view of the files (only services, images and volume paths are read from it: the resolved config can hold secrets), the images' VOLUMEs and the containers. A service whose image isn't on the engine can't be checked: pull it (or build it) first.

Enter (or a double-click) opens the volume a container holds now. Right-click to open its container or copy a name.`,
  },
  "compose.run": {
    title: "Compose output",
    body: `Compose's output for the command, as it runs. Compose writes its progress to stderr, so only lines that mention an error are shown as errors.

- **Stop** while it's running cancels the command. What compose already did stays done.
- **Close** when it's finished. After an up from a dropped file, closing opens the project.

If it fails, the last lines usually say why: a port already in use, an image that can't be pulled, or a path that doesn't exist where compose runs (check **Settings**: inside WSL, Windows paths become \`/mnt/<drive>/…\`).`,
  },
  "compose.drop": {
    title: "Start a compose project",
    body: `You dropped compose files, or a folder holding them, onto the window. Ticked files are passed to compose (as \`-f\`) in the order shown, then the project is pinned and \`up -d\` runs.

- A folder offers compose's default file (\`compose.yaml\`, \`docker-compose.yml\` and so on), its override, and any \`compose-*\` or \`docker-compose-*\` variants. The base and override are ticked; tick a variant to add it.
- **Project** is the name compose gives these files, usually the folder's name or the \`name:\` in the file.
- A warning shows if a project of that name already exists. Up recreates what changed, and starting it from other files replaces its pin.
- Several folders are separate projects, asked about in turn: **Skip** goes to the next one.

Folders compose can't reach from where it runs (a network share, or another WSL distro) are listed as skipped.`,
  },
};
