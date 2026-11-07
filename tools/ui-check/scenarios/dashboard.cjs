// The dashboard layout: switching from Explorer keeps the place and the tabs,
// boards (grouped containers, inline actions, More, the bulk bar, compose
// cards, resource tables), the overview (totals, top lists, attention,
// projects, quick actions, the cap), the side nav and header navigate, Explorer's tab / address keys do
// nothing, the details drawer, a collapsed nav, the Layout setting, and back.
module.exports = async (page, { shot }) => {
  await page.waitForSelector(".status-bar:has-text('ubuntu-dev · tcp://localhost:2375')");

  // Explorer: two tabs, the second in Containers.
  await page.dblclick(".fl-row:has-text('Images')");
  await page.waitForSelector(".tab.active:has-text('Images')");
  await page.keyboard.press("Control+t");
  await page.click(".tree-row:has-text('Containers')");
  await page.waitForSelector(".fl-row:has-text('monitoring')");
  if ((await page.$$(".tab")).length !== 2) throw new Error("expected two tabs before switching");

  // Switch: same place, no tabs or address bar.
  await page.click(".cmd-btn:has-text('Dashboard')");
  await page.waitForSelector(".dash .dash-title:has-text('Containers')");
  await page.waitForSelector(".dash-nav-item.active:has-text('Containers')");
  if (await page.$(".tab, .address-bar, .tree")) throw new Error("Explorer chrome shown in the dashboard");
  // The containers board: projects with their containers under them.
  await page.waitForSelector(".bd-row.parent:has-text('shop')");
  await page.waitForSelector(".bd-row.child:has-text('shop-web-1')");
  await shot("containers");

  // Inline Stop, the More menu, and the bulk bar.
  await page.click(".bd-row.child:has-text('shop-web-1') .bd-act[aria-label='Stop']");
  await page.waitForSelector(".status-bar:has-text('Stopped 1 container')");
  await page.click(".bd-row.child:has-text('shop-web-1') .bd-act[aria-label='Start']");
  await page.waitForSelector(".status-bar:has-text('Started 1 container')");
  await page.click(".bd-row:has-text('postgres') .bd-act[aria-label='More']");
  await page.waitForSelector(".cm-item:has-text('Copy ID')");
  await page.keyboard.press("Escape");
  // More selected postgres (as a right-click does); a tick adds another.
  await page.click(".bd-row:has-text('redis-scratch') input[type=checkbox]");
  await page.waitForSelector(".bd-bulk:has-text('2 selected')");
  await shot("board-bulk");
  await page.click(".bd-bulk .btn:has-text('Delete')");
  await page.waitForSelector("[role=alertdialog], [role=dialog]");
  await page.click(".dialog .btn:has-text('Cancel')");
  await page.click(".bd-bulk .link-btn:has-text('Clear selection')");
  if (await page.$(".bd-bulk")) throw new Error("the bulk bar should go once nothing is selected");

  // Compose as cards; images, volumes and networks as tables.
  await page.click(".dash-nav-item:has-text('Compose')");
  await page.waitForSelector(".bd-card:has-text('blog') .btn:has-text('Up')");
  await shot("compose-cards");
  await page.click(".dash-nav-item:has-text('Images')");
  await page.waitForSelector(".bd-row >> nth=5");
  await shot("images");
  await page.click(".dash-nav-item:has-text('Networks')");
  if (!(await page.isDisabled(".bd-row:has-text('bridge') .bd-act[aria-label='Delete…']"))) throw new Error("Docker's own networks can't be deleted");
  await page.click(".dash-nav-item:has-text('Volumes')");
  await page.waitForSelector(".bd-row:has-text('shop_pgdata')");

  // Overview: live totals, top consumers, what needs attention, projects.
  await page.click(".dash-nav-item:has-text('Overview')");
  await page.waitForSelector(".dash-title:has-text('Overview')");
  await page.waitForSelector(".ov-caption:has-text('Across 5 containers running')");
  await page.waitForSelector(".ov-top li >> nth=3");
  await page.waitForSelector(".ov-row:has-text('api-canary')");
  await page.waitForSelector(".ov-row:has-text('Images') >> text=orphaned");
  await page.waitForSelector(".ov-project:has-text('shop')");
  await page.waitForTimeout(3000); // a few points of history for the sparklines
  await shot("overview");

  // Quick actions: restart a problem container; Up opens compose's run dialog.
  await page.click(".ov-row:has-text('api-canary') .btn:has-text('Restart')");
  await page.waitForSelector(".status-bar:has-text('Restarted 1 container')");
  await page.click(".ov-project:has-text('monitoring') .btn:has-text('Up')");
  await page.waitForSelector("[role=dialog]:has-text('Started')");
  await shot("overview-run");
  await page.click("[role=dialog] .btn:has-text('Close')");

  // Past the cap, it says so.
  await page.evaluate(() => (window.__totalsSkipped = 40));
  await page.waitForSelector(".ov-caption:has-text('only the first 5 are counted')");
  await page.waitForSelector(".badge-warn:has-text('Capped')");
  await page.evaluate(() => (window.__totalsSkipped = 0));

  // Into a container, then deeper; the breadcrumb follows.
  await page.click(".dash-nav-item:has-text('Containers')");
  await page.click(".bd-row.parent:has-text('shop') .bd-name");
  await page.waitForSelector(".dash-title:has-text('shop')");
  await page.click(".bd-name:text-is('shop-web-1')");
  await page.waitForSelector(".dash-title:has-text('shop-web-1')");
  await page.waitForSelector(".dash-crumb:has-text('Containers')");
  await page.click(".fl-row:has-text('Environment')");
  await page.keyboard.press("Alt+Shift+P");
  await page.waitForSelector(".dash-drawer");
  await shot("container-drawer");

  // Explorer-only keys do nothing here; history and up still work.
  await page.keyboard.press("Control+t");
  await page.keyboard.press("Control+w");
  await page.keyboard.press("Control+l");
  if (await page.$(".address-input")) throw new Error("Ctrl+L opened an address box in the dashboard");
  await page.keyboard.press("Backspace");
  await page.waitForSelector(".dash-title:has-text('shop')");
  await page.keyboard.press("Alt+ArrowLeft");
  await page.waitForSelector(".dash-title:has-text('shop-web-1')");
  await page.click(".dash-crumb:has-text('Containers')");
  await page.waitForSelector(".dash-title:has-text('Containers')");

  // Collapsed nav keeps icons and tooltips.
  await page.click(".dash-nav-head .tool-btn");
  await page.waitForSelector(".dash-nav.collapsed");
  await page.waitForSelector(".dash-nav-item[title^='Volumes']");
  await shot("collapsed");
  await page.click(".dash-nav-head .tool-btn");

  // The Layout setting, then back to Explorer from the header.
  await page.click(".dash-nav-item:has-text('Settings')");
  await page.waitForSelector("[role=dialog] legend:has-text('Layout')");
  if (!(await page.isChecked("input[name=layout] >> nth=1"))) throw new Error("Settings should show the dashboard chosen");
  await shot("settings");
  await page.click("[role=dialog] .btn:has-text('Cancel')");
  await page.click(".cmd-btn:has-text('Explorer')");
  await page.waitForSelector(".tab.active:has-text('Containers')");
  if ((await page.$$(".tab")).length !== 2) throw new Error("expected both tabs back in Explorer");
  await page.waitForSelector(".tab:has-text('Images')");

  // And the Settings dialog can switch too; losing the engine shows on the overview.
  await page.click(".cmd-btn:has-text('Settings')");
  await page.check("input[name=layout] >> nth=1");
  await page.click("[role=dialog] .btn:has-text('Save')");
  await page.waitForSelector(".dash .dash-title:has-text('Containers')");
  await page.click(".dash-nav-item:has-text('Overview')");
  await page.waitForSelector(".ov-caption:has-text('Across')");
  await page.evaluate(() => window.__engine({ type: "disconnected", message: "Can't reach the Docker engine." }));
  await page.waitForSelector(".ov-error:has-text('Not connected')");
};
