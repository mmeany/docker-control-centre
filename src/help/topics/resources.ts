// Images, volumes and networks: lists, items, the pull dialog.
const BOARD = `- Each row has **Delete…**; tick rows, or Ctrl+click them, for a bar that deletes all of them. Esc clears the selection.
- Click a name, or double-click a row, to open it. **Details** in the header shows the selected item's properties.`;

const PRUNE_NOTE = `Prune shows exactly what it will delete before anything goes, and deletes just those, one by one. **Orphaned only** (the orange marks) is the safe choice; **All unused** also takes what only stopped containers use.`;

const IMAGES = `- **Pull…** downloads an image from a registry, such as \`nginx:1.27\`, with progress per layer.
- **Delete…** (Del) removes the selected images and their tags. Docker won't delete an image a running container uses; you can tick to also delete ones that stopped containers use.
- **Prune…** deletes images no container uses. ${PRUNE_NOTE}`;

const VOLUMES = `- **Delete…** (Del) needs the volume's name typed: the data in it is gone for good. Volumes a container uses can't be deleted.
- **Prune…** deletes volumes no container uses. Orphaned volumes are anonymous ones nothing mounts, or ones left by a compose project that's gone. ${PRUNE_NOTE}`;

const NETWORKS = `- **Delete…** (Del) asks first. Docker's own networks (bridge, host, none) can't be deleted, and Docker refuses to delete a network containers are attached to.
- **Prune…** deletes networks no container is attached to. Orphaned networks were left by a compose project that's gone. ${PRUNE_NOTE}`;

export const resourcesTopics = {
  "images.list.explorer": {
    title: "Images",
    body: `The images on the engine, with their size and the containers that use them.

${IMAGES}

Open an image with Enter or a double-click for its configuration and history. Right-click to copy its name or ID.`,
  },
  "images.list.dashboard": {
    title: "Images",
    body: `The images on the engine, with their size and the containers that use them.

${BOARD}

${IMAGES}`,
  },
  "images.image": {
    title: "Image",
    body: `One image: its tags, size, when it was built, its platform and command.

- **Used by:** containers created from it. Click one to open it.
- **Environment** and **Labels** it sets for containers.
- **History:** the steps that built it (the Dockerfile's instructions) and the size each added.

**Delete** removes it and its tags, after asking. **Copy ID** copies its ID.`,
  },
  "images.pull": {
    title: "Pulling an image",
    body: `Docker is downloading the image, a layer at a time. The bar shows the bytes for layers whose size is known, and each layer's status is listed below it.

- Layers you already have (from other images) say *Already exists* and aren't downloaded again.
- **Cancel** stops the pull. Layers already downloaded are kept, so pulling again carries on.

When it finishes, the image is in the list. A private registry needs \`docker login\` on the engine first.`,
  },
  "volumes.list.explorer": {
    title: "Volumes",
    body: `Named and anonymous volumes, with the compose project they belong to and the containers that use them.

${VOLUMES}

Open a volume with Enter or a double-click to see what uses it. Right-click to copy its name.`,
  },
  "volumes.list.dashboard": {
    title: "Volumes",
    body: `Named and anonymous volumes, with the compose project they belong to and the containers that use them.

${BOARD}

${VOLUMES}`,
  },
  "volumes.volume": {
    title: "Volume",
    body: `One volume: its driver, where the engine keeps it (the mount point is inside the engine, in WSL for a WSL engine), its project and labels.

- **Used by:** containers that mount it, running or stopped. Click one to open it.

**Delete** needs the volume's name typed, because its data can't be got back.`,
  },
  "networks.list.explorer": {
    title: "Networks",
    body: `The engine's networks, with their driver, subnet, project and the containers attached.

${NETWORKS}

Open a network with Enter or a double-click to see its containers. Right-click to copy its ID.`,
  },
  "networks.list.dashboard": {
    title: "Networks",
    body: `The engine's networks, with their driver, subnet, project and the containers attached.

${BOARD}

${NETWORKS}`,
  },
  "networks.network": {
    title: "Network",
    body: `One network: its driver, scope, subnets and gateways, and its project and labels.

- **Containers:** the containers attached, running or stopped. Click one to open it.

**Delete** asks first; Docker's own networks (bridge, host, none) can't be deleted.`,
  },
};
