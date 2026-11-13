// General help for each layout, connecting, Home / the overview, Settings.
export const generalTopics = {
  "general.explorer": {
    title: "Docker Control Centre",
    body: `Docker Control Centre manages one Docker engine the way File Explorer manages files: the tree on the left, the current place on the right, and commands above it. Compose projects, containers, images, volumes and networks are folders you open.

### Moving around

- **Open** an item with Enter or a double-click, or expand it in the tree.
- **Address bar:** every place has an address such as \`/containers/@shop/shop-web-1/logs\`. Click a part to go there, or press Ctrl+L and type one. The button beside it copies the address.
- **Tabs** each keep their own back and forward history. Right-click an item for **Open in new tab**.
- **Show** above the tree: the tree shows running items and problems by default. Choose *Running and stopped* or *Everything* to see more, or click a "+ n more" row to reveal one branch. Lists on the right always show everything.
- **Details pane** (Alt+Shift+P): properties of the selected item, on the right.
- **Columns:** click a heading to sort. Drag a heading's right edge to resize it, or double-click the edge to fit the widest row on screen. Right-click the headings for **Reset column widths**. Widths are remembered for each kind of list, such as all projects' containers.

### Colours

Every item has a coloured mark for its state: running, idle, unused, orphaned (safe to prune) or a problem. **Help › What the colours mean** lists them.

### Shortcuts

| Keys | Action |
|---|---|
| F1 | Help for the current view or dialog |
| Enter / double-click | Open |
| Backspace, Alt+↑ | Up one level |
| Alt+← / Alt+→ | Back / forward |
| F5 | Refresh |
| Ctrl+A | Select all |
| Del | Delete the selected items (asks first) |
| Ctrl+T / Ctrl+W | New tab / close tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+L, Alt+D | Type an address |
| Ctrl+Shift+5 / 6 / 7 | List / details / tiles view |
| Alt+Shift+P | Show or hide the details pane |

In a container terminal the shell gets every key except F1.

### Starting a project by dropping it

Drag a compose file, or a folder holding one, from File Explorer onto the window to pin the project and bring it up.

**Dashboard** in the top bar switches to the dashboard layout. **Settings** chooses the layout and where compose runs.`,
  },
  "general.dashboard": {
    title: "Docker Control Centre",
    body: `Docker Control Centre manages one Docker engine. In the dashboard layout the sections are in the side panel on the left, with the place you're in as a breadcrumb in the header.

### Moving around

- **Side panel:** the overview and each section, with a count of problems and orphans. The button at its top hides it down to icons.
- **Header:** back, forward and up, the breadcrumb (click a part to go there), copy the address, refresh, and **Details**, which opens the selected item's properties in a drawer on the right.
- **Boards:** lists show each row's common actions as buttons, and the rest under **More**. Tick rows (or Ctrl+click them) for a bar that acts on all of them; Esc clears the selection.
- Opening an item shows the same logs, terminal, stats, files and details views as the Explorer layout.

### Colours

Every item has a coloured mark for its state: running, idle, unused, orphaned (safe to prune) or a problem. **Help › What the colours mean** lists them.

### Shortcuts

| Keys | Action |
|---|---|
| F1 | Help for the current view or dialog |
| Enter / double-click | Open |
| Backspace, Alt+↑ | Up one level |
| Alt+← / Alt+→ | Back / forward |
| F5 | Refresh |
| Ctrl+A | Select all on a board |
| Del | Delete the selected items (asks first) |
| Alt+Shift+P | Show or hide the details drawer |

There are no tabs or address bar here, so their shortcuts do nothing.

### Starting a project by dropping it

Drag a compose file, or a folder holding one, from File Explorer onto the window to pin the project and bring it up.

**Explorer** in the header switches back to the Explorer layout, with your tabs as you left them. **Settings** chooses the layout and where compose runs.`,
  },
  connecting: {
    title: "Connecting to Docker",
    body: `The app isn't connected to a Docker engine. The status bar shows what went wrong, and it keeps trying: lists fill in as soon as the engine answers.

### Which engine

- If \`DOCKER_HOST\` is set, the app uses it: \`tcp://\`, \`npipe://\` and \`unix://\` addresses work (no TLS or SSH yet).
- Otherwise it uses \`tcp://localhost:2375\`, which suits Docker Engine in WSL with its API published on localhost.

To use another engine, set \`DOCKER_HOST\` and restart the app.

### Docker Engine in WSL

Check that the engine is running in WSL (\`sudo service docker status\`) and that it listens on \`tcp://localhost:2375\`. The repository's \`docs/WSL-SETUP.md\` walks through the setup.

Port 2375 has no authentication. Only bind it to localhost, never to \`0.0.0.0\`.`,
  },
  "home.explorer": {
    title: "Home",
    body: `The sections of the app, with what needs attention in each: problems (red) and orphans (orange). Open a section with Enter or a double-click, or from the tree.

- **Containers:** compose projects and their containers, and standalone containers.
- **Compose:** projects that are running or pinned, with up, stop, restart, pull and down.
- **Images**, **Volumes** and **Networks:** what's on the engine, what uses it, delete and prune.

The status bar shows the engine's version and totals.`,
  },
  "home.dashboard": {
    title: "Overview",
    body: `A live view of the whole engine.

- **Totals:** CPU, memory, network and disk use across running containers, with five minutes of history. They count at most 100 containers, and say so when there are more.
- **Top CPU** and **Top memory:** the five busiest containers. Click one to open its stats.
- **Needs attention:** containers that crashed or are unhealthy, with Restart and Logs, and orphaned items with **Review**, which opens the section to prune them.
- **Compose projects:** a card per project, with Up or Stop.

The totals only run while the overview is open. Choose a section in the side panel to see everything in it.`,
  },
  settings: {
    title: "Settings",
    body: `- **Layout:** Explorer (tree, tabs and an address bar) or the dashboard (side panel, overview and boards). Switching keeps you where you are.
- **Run docker compose:** *Inside WSL* for Docker Engine running in WSL, so bind-mount paths resolve on the Linux side. Windows paths are converted (\`E:\\projects\\shop\` becomes \`/mnt/e/projects/shop\`). *On this computer* runs \`docker compose\` directly, for Docker Desktop.
- **WSL distro:** which distro compose runs in; *Default* is WSL's default distro. Folders inside another distro can't be used from this one.
- **Test** saves, then runs \`docker compose version\` the way projects will run, so you can see it works.

Settings are saved in \`%APPDATA%\\com.mmeany.dockercontrolcentre\\settings.json\`. Nothing secret is stored there.`,
  },
};
