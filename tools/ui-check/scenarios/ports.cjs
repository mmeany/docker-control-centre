// A stopped container's ports: the engine's list has none, so the lists show
// the configured ones, faded with a tooltip; the Ports view says they're
// published when it starts.
module.exports = async (page, { shot }) => {
  await page.waitForSelector(".status-bar:has-text('ubuntu-dev · tcp://localhost:2375')");
  const go = async (address) => {
    await page.keyboard.press("Control+l");
    await page.fill(".address-input", address);
    await page.keyboard.press("Enter");
  };

  // A compose project's containers.
  await go("/compose/shop");
  const cell = page.locator(".fl-row:has-text('shop-worker-1') .fl-cell.muted");
  await cell.waitFor();
  if ((await cell.textContent()) !== "9100→9100/tcp") throw new Error(`configured ports: ${await cell.textContent()}`);
  if ((await cell.getAttribute("title")) !== "Not running: published when it starts.") throw new Error("no tooltip");
  // Running containers' ports aren't faded.
  await page.waitForSelector(".fl-row:has-text('shop-web-1') .fl-cell:not(.muted):text-is('8080→80/tcp')");
  await shot("compose-project");

  // The containers list does the same.
  await go("/containers/@shop");
  await page.waitForSelector(".fl-row:has-text('shop-worker-1') .fl-cell.muted:text-is('9100→9100/tcp')");

  // The Ports view.
  await go("/containers/@shop/shop-worker-1/ports");
  await page.waitForSelector(".hint:has-text('these are published when it starts')");
  await page.waitForSelector(".data-table th:has-text('Published on when it starts')");
  await page.waitForSelector(".data-table td:has-text('0.0.0.0:9100')");
  await shot("ports-view");
};
