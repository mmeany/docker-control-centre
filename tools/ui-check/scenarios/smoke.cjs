// Smoke test of the shell and the Containers section. Copy this file to add a
// scenario: each exports async (page, { shot, theme }) and uses Playwright.
module.exports = async (page, { shot }) => {
  await page.waitForSelector(".app");
  await page.waitForSelector(".status-bar:has-text('ubuntu-dev · tcp://localhost:2375')");
  await shot("home");

  // Into Containers: projects first, then standalone containers.
  await page.dblclick(".fl-row:has-text('Containers')");
  await page.waitForSelector(".fl-row:has-text('monitoring')");
  await page.waitForSelector(".status-bar:has-text('2 projects · 7 containers · 4 running')");
  await shot("containers");

  // Project, container, child.
  await page.dblclick(".fl-row:has-text('shop')");
  await page.waitForSelector(".fl-row:has-text('shop-worker-1')");
  await page.dblclick(".fl-row:has-text('shop-web-1')");
  await page.waitForSelector(".fl-row:has-text('Terminal')");
  await page.waitForSelector(".address-bar:has-text('shop') >> text=shop-web-1");
  await shot("container");

  // Typed address.
  await page.keyboard.press("Control+l");
  await page.fill(".address-input", "/containers/postgres");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".status-bar:has-text('postgres · postgres:17')");

  // A bad address keeps the bar open and marked.
  await page.keyboard.press("Control+l");
  await page.fill(".address-input", "/nowhere");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".address-input.bad");
  await page.keyboard.press("Escape");

  // Back, then a new tab via the context menu, with its own history.
  await page.click(".tool-btn[title^='Back']");
  await page.waitForSelector(".fl-row:has-text('Logs')");
  await page.click(".tool-btn[title^='Up']");
  await page.waitForSelector(".fl-row:has-text('shop-api-1')");
  await page.click(".fl-row:has-text('shop-api-1')", { button: "right" });
  await page.click(".cm-item:has-text('Open in new tab')");
  await page.waitForSelector(".tab.active:has-text('shop-api-1')");
  if ((await page.$$(".tab")).length !== 2) throw new Error("expected two tabs");
  await shot("tabs");

  // Live update: the engine reports a stop; the list reloads.
  await page.click(".tab:has-text('shop')");
  await page.evaluate(() => {
    window.__containers[0].state = "exited";
    window.__containers[0].status = "Exited (0) 1 second ago";
    window.__engine({ type: "changed", resource: "container", action: "die", id: window.__containers[0].id });
  });
  await page.waitForSelector(".fl-row:has-text('Exited (0) 1 second ago')");

  // Losing the engine shows in the status bar.
  await page.evaluate(() => window.__engine({ type: "disconnected", message: "Can't reach the Docker engine at tcp://localhost:2375. Is it running?" }));
  await page.waitForSelector(".status-bar:has-text('Not connected')");
  await shot("disconnected");

  await page.keyboard.press("Control+w");
  if ((await page.$$(".tab")).length !== 1) throw new Error("expected one tab after Ctrl+W");
};
