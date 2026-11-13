// A compose project's unnamed volumes (/compose/<project>/volumes): the list
// with causes and proposed names, opening the volume a container holds, a
// service whose image can't be checked, and the dashboard's board.
module.exports = async (page, { shot }) => {
  await page.waitForSelector(".status-bar:has-text('ubuntu-dev · tcp://localhost:2375')");
  const go = async (address) => {
    await page.keyboard.press("Control+l");
    await page.fill(".address-input", address);
    await page.keyboard.press("Enter");
  };

  // The project lists it beside Logs and Compose file, with what's in use.
  await go("/compose/shop");
  await page.waitForSelector(".fl-row:has-text('Unnamed volumes'):has-text('1 in use')");

  await go("/compose/shop/volumes");
  await page.waitForSelector(".unnamed-notes .hint:has-text('Volumes Docker makes with no name')");
  const web = page.locator(".fl-row:has-text('/var/cache/nginx')");
  await web.waitFor();
  for (const t of ["Image VOLUME", "shop-web-nginx", "(shop-web-1)"]) if (!(await web.textContent()).includes(t)) throw new Error(`web row lacks ${t}`);
  await page.waitForSelector(".fl-row:has-text('/tmp/cache') .fl-cell.muted:text-is('None yet')");
  await page.waitForSelector(".status-bar:has-text('shop · 2 unnamed volumes')");
  await shot("compose-volumes");

  // Enter opens the volume the container holds.
  await web.dblclick();
  await page.waitForSelector(".props-table td:has-text('shop-web-1:/var/cache/nginx')");

  // A service whose image isn't pulled.
  await go("/compose/monitoring/volumes");
  await page.waitForSelector(".warn-note:has-text('Pull to check: grafana (grafana/grafana:11.4.0)')");
  await page.waitForSelector(".empty-note:has-text('No unnamed volumes')");

  // The dashboard's board, same rows (switching keeps the place).
  await go("/compose/shop/volumes");
  await page.waitForSelector(".fl-row:has-text('/var/cache/nginx')");
  await page.click(".cmd-btn:has-text('Dashboard')");
  await page.waitForSelector(".dash .unnamed-notes");
  await page.waitForSelector(".dash :text('shop-worker-cache')");
  await shot("compose-volumes-dashboard");
};
