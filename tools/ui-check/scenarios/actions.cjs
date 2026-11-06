// Container actions, inspect children, views and the details pane.
module.exports = async (page, { shot }) => {
  await page.waitForSelector(".status-bar:has-text('ubuntu-dev · tcp://localhost:2375')");
  await page.click(".tree-row:has-text('shop')");
  await page.waitForSelector(".fl-row:has-text('shop-web-1')");

  // Details pane follows the selection.
  await page.click(".cmd-btn:has-text('Details pane')");
  await page.click(".fl-row:has-text('shop-web-1')");
  await page.waitForSelector(".pane-details:has-text('daemon off')");
  await shot("details-pane");

  // Stop updates the list through the engine feed.
  await page.click(".cmd-btn:has-text('Stop')");
  await page.waitForSelector(".status-bar:has-text('Stopped 1 container')");
  await page.waitForSelector(".fl-row:has-text('shop-web-1') >> text=exited");

  // Delete two (one running): the dialog warns, then they go.
  await page.click(".fl-row:has-text('shop-api-1')");
  await page.click(".fl-row:has-text('shop-worker-1')", { modifiers: ["Control"] });
  await page.keyboard.press("Delete");
  await page.waitForSelector(".dialog:has-text('shop-api-1 is running and will be stopped first')");
  await shot("delete-dialog");
  await page.click(".dialog .btn.danger");
  await page.waitForSelector(".status-bar:has-text('Deleted 2 containers')");
  if (await page.$(".fl-row:has-text('shop-api-1')")) throw new Error("shop-api-1 should be gone");

  // Environment masks secrets.
  await page.keyboard.press("Control+l");
  await page.fill(".address-input", "/containers/postgres/env");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".data-table:has-text('POSTGRES_PASSWORD')");
  if (await page.$(".data-table:has-text('example-only')")) throw new Error("secret shown before Reveal");
  await shot("environment");

  // Tiles view at the root.
  await page.click(".tree-row:has-text('Containers')");
  await page.click(".segmented button:has-text('Tiles')");
  await page.waitForSelector(".fl-tiles .fl-item:has-text('monitoring')");
  await shot("tiles");
};
