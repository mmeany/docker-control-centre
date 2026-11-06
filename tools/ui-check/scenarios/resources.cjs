// Images (pull, prune preview), volumes (typed delete), networks (built-ins
// protected, detail, cross-link to a container).
module.exports = async (page, { shot }) => {
  await page.waitForSelector(".status-bar:has-text('ubuntu-dev · tcp://localhost:2375')");

  // Images: untagged sort last; pull shows progress, then the new image.
  await page.click(".tree-row:has-text('Images')");
  await page.waitForSelector(".fl-row:has-text('nginx:1.27')");
  const last = await page.$$eval(".fl-row", (rows) => rows[rows.length - 1].textContent);
  if (!last.includes("<none>")) throw new Error("untagged images should sort last");
  await page.click(".cmd-btn:has-text('Pull…')");
  await page.fill(".dialog input", "alpine:3.20");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".dialog:has-text('Pulling alpine:3.20') .pull-layer");
  await shot("pull");
  await page.waitForSelector(".status-bar:has-text('Pulled alpine:3.20')", { timeout: 5000 });
  await page.waitForSelector(".fl-row:has-text('alpine:3.20')");

  // Prune: choose a scope, see exactly what goes, nothing a container uses.
  await page.click(".cmd-btn:has-text('Prune…')");
  await page.click(".dialog .btn:has-text('All unused')");
  await page.waitForSelector(".dialog:has-text('alpine:3.20')");
  if (await page.$(".dialog .name-list:has-text('redis:7.4')")) throw new Error("prune listed an image a stopped container uses");
  await shot("prune-preview");
  await page.click(".dialog .btn.danger");
  await page.waitForSelector(".status-bar:has-text('Deleted')");

  // Volumes: deleting needs the name typed.
  await page.click(".tree-row:has-text('Volumes')");
  await page.click(".fl-row:has-text('old_cache')");
  await page.keyboard.press("Delete");
  await page.waitForSelector(".dialog:has-text('deleted for good')");
  await page.fill(".dialog input", "old_cache");
  await page.click(".dialog .btn.danger");
  await page.waitForSelector(".status-bar:has-text('Deleted 1 volume')");

  // Networks: built-ins can't be deleted; detail links to containers.
  await page.click(".tree-row:has-text('Networks') >> nth=0");
  // "bridge" is also every other network's driver: pick Docker's own row.
  await page.click(".fl-row:has-text('bridge (Docker')");
  if (!(await page.$(".cmd-btn:has-text('Delete'):disabled"))) throw new Error("Delete should be off for bridge");
  await page.dblclick(".fl-row:has-text('shop_default')");
  await page.waitForSelector(".data-table:has-text('shop-api-1')");
  await shot("network");
  await page.dblclick(".data-table tr:has-text('shop-api-1')");
  await page.waitForSelector(".address-bar:has-text('shop-api-1')");
};
