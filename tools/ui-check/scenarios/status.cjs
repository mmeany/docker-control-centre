// Status colours: marks, label colours and tooltips in the tree and lists,
// project roll-ups, section badges, Orphaned folders, the legend, the
// "Orphaned only" prune choice and tab marks.
module.exports = async (page, { shot }) => {
  await page.waitForSelector(".status-bar:has-text('ubuntu-dev · tcp://localhost:2375')");
  const label = (row, state) => page.waitForSelector(`.tree-row:has-text('${row}') .tree-label.st-${state}`);
  // Show everything: this scenario checks every state's colours.
  await page.selectOption("#tree-level", "all");

  // Containers: crashes and failing health checks are red; clean stops grey.
  await label("redis-scratch", "error");
  await label("api-canary", "error");
  await label("postgres", "running");
  await page.click(".tree-row:has-text('shop') >> nth=0");
  await label("shop-worker-1", "stopped");
  await label("shop", "partial");
  const tip = await page.getAttribute(".tree-row:has-text('redis-scratch')", "title");
  if (!/exit code 137/.test(tip)) throw new Error(`tooltip was ${tip}`);
  await page.waitForSelector(".tree-row:has-text('Containers') .tree-badge.st-error:has-text('2')");

  // Lists carry the same marks; the State column says why.
  await page.click(".tree-row:has-text('Containers') >> nth=0");
  await page.waitForSelector(".fl-row:has-text('redis-scratch') .status-mark.st-error");
  await page.waitForSelector(".fl-row:has-text('redis-scratch') >> text=Exit 137");
  await page.waitForSelector(".fl-row:has-text('api-canary') >> text=Unhealthy");
  await shot("containers");
  await page.click(".segmented button:has-text('Tiles')");
  await page.waitForSelector(".fl-item:has-text('redis-scratch') .fl-tile-sub.st-error");
  await page.click(".segmented button:has-text('Details')");

  // Volumes: orphans grouped and counted; prune leads with them.
  await page.click(".tree-row:has-text('Volumes') .twisty");
  await page.waitForSelector(".tree-row:has-text('Orphaned (2)') .tree-label.st-orphaned");
  await page.waitForSelector(".tree-row:has-text('Volumes') .tree-badge.st-orphaned:has-text('2')");
  await label("legacy_db", "orphaned");
  await label("shop_pgdata", "running");
  await label("old_cache", "unused");
  await page.click(".tree-row:has-text('Volumes') >> nth=0");
  await page.click(".cmd-btn:has-text('Prune')");
  await page.waitForSelector(".dialog .btn.primary:has-text('Orphaned only (2)')");
  await shot("prune-orphaned");
  await page.keyboard.press("Escape");

  // Images: a stopped container's image is idle; untagged ones orphaned.
  await page.click(".tree-row:has-text('Images') .twisty");
  await label("redis:7.4", "idle");
  await page.waitForSelector(".tree-row:has-text('Orphaned (2)')");

  // Networks: a gone project's network is orphaned; Docker's own never are.
  await page.click(".tree-row:has-text('Networks') .twisty");
  await label("legacy_default", "orphaned");
  await label("host", "unused");
  await shot("tree");

  // Home: what needs attention, per section.
  await page.click(".tree-row:has-text('ubuntu-dev') >> nth=0");
  await page.waitForSelector(".fl-row:has-text('Containers') >> text=2 with problems");
  await page.waitForSelector(".fl-row:has-text('Volumes') >> text=2 orphaned");

  // Tabs show the open item's mark.
  await page.click(".tree-row:has-text('redis-scratch')");
  await page.waitForSelector(".tab.active .status-mark.st-error");

  // The legend explains every state.
  await page.click(".cmd-btn:has-text('Help')");
  await page.click(".cm-item:has-text('What the colours mean')");
  await page.waitForSelector(".dialog:has-text('What the colours mean')");
  const states = await page.$$eval(".legend-table tr", (r) => r.length);
  if (states !== 11) throw new Error(`legend has ${states} states`);
  await shot("legend");
};
