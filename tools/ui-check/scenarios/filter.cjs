// Tree filtering: Running by default, "+ n more" rows that reveal a branch
// until it's collapsed, the three Show levels, the open item always shown,
// badges counting everything, and the level saved to settings.
module.exports = async (page, { shot }) => {
  await page.waitForSelector(".status-bar:has-text('ubuntu-dev · tcp://localhost:2375')");
  const row = (text) => `.tree-row:has-text('${text}')`;
  const gone = (text) => page.waitForSelector(row(text), { state: "detached" });
  if ((await page.inputValue("#tree-level")) !== "running") throw new Error("the tree should start at Running");

  // Containers: running ones and problems show; a project's stopped one is hidden.
  await page.waitForSelector(row("postgres"));
  await page.waitForSelector(row("redis-scratch")); // crashed: a problem, so shown
  await page.click(`${row("shop")} >> nth=0`);
  await page.waitForSelector(row("shop-web-1"));
  await gone("shop-worker-1");
  await page.waitForSelector(".tree-more:has-text('+ 1 stopped')");

  // Volumes: only what running containers use; the rest behind "+ 3 more".
  await page.click(`${row("Volumes")} .twisty`);
  await page.waitForSelector(row("shop_pgdata"));
  await gone("old_cache");
  await gone("Orphaned (2)");
  await page.waitForSelector(`${row("Volumes")} .tree-badge.st-orphaned:has-text('2')`); // badges count everything
  await page.waitForSelector(".tree-more:has-text('+ 3 more')");
  await shot("running");

  // Reveal the branch, then collapse it: back to the Show level.
  await page.click(".tree-more:has-text('+ 3 more')");
  await page.waitForSelector(row("old_cache"));
  await page.waitForSelector(row("Orphaned (2)"));
  await page.click(`${row("Volumes")} .twisty`);
  await page.click(`${row("Volumes")} .twisty`);
  await gone("old_cache");

  // Running and stopped: idle and stopped show; unused and orphaned don't.
  await page.selectOption("#tree-level", "stopped");
  await page.waitForSelector(row("shop-worker-1"));
  await page.click(`${row("Images")} .twisty`);
  await page.waitForSelector(row("redis:7.4")); // idle
  await gone("node:22-bookworm-slim"); // unused
  await page.waitForSelector(`${row("Compose")} >> nth=0`);
  await page.waitForSelector(row("blog")); // pinned and down
  await shot("stopped");

  // Everything.
  await page.selectOption("#tree-level", "all");
  await page.waitForSelector(row("node:22-bookworm-slim"));
  await page.waitForSelector(row("old_cache"));
  if (await page.$(".tree-more")) throw new Error("Everything hides nothing");
  const saved = await page.evaluate(() => window.__calls.filter((c) => c[0] === "set_value" && c[1].key === "app.treeLevel").map((c) => c[1].value));
  if (saved[saved.length - 1] !== "all") throw new Error(`saved level was ${saved}`);

  // An opened item shows even when its level hides it.
  await page.selectOption("#tree-level", "running");
  await gone("node:22-bookworm-slim");
  await page.keyboard.press("Control+l");
  await page.fill(".address-input", "/volumes/old_cache");
  await page.keyboard.press("Enter");
  await page.waitForSelector(`${row("old_cache")}.selected`);
  await shot("open-hidden");
};
