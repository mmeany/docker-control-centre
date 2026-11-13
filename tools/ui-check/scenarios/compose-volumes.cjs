// A compose project's unnamed volumes (/compose/<project>/volumes): the list
// with causes and proposed names, opening the volume a container holds, a
// service whose image can't be checked, the Name volumes dialog (diff,
// snippet fallback, name clash, save) and the dashboard's board.
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

  // Name volumes: web's goes in the file, the worker's is left as a snippet.
  await go("/compose/shop/volumes");
  await page.click(".cmd-btn:has-text('Name volumes')");
  const dlg = page.locator(".name-volumes-dialog");
  await dlg.locator(".diff-line.add:has-text('- web-nginx:/var/cache/nginx')").waitFor();
  await dlg.locator(".diff-line.add:has-text('name: shop-web-nginx')").waitFor();
  await dlg.locator(".name-volumes-manual:has-text('worker /tmp/cache has to be named by hand')").waitFor();
  await shot("compose-name-volumes");

  // A name another volume has blocks saving.
  const save = dlg.locator("button:has-text('Save in place')");
  await dlg.locator("input[aria-label='Name for /var/cache/nginx']").fill("shop_pgdata");
  await dlg.locator(".field-error:has-text('A volume called shop_pgdata already exists.')").waitFor();
  if (await save.isEnabled()) throw new Error("Save in place should wait on the clash");
  await dlg.locator("input[aria-label='Name for /var/cache/nginx']").fill("shop-nginx-cache");
  await dlg.locator(".diff-line.add:has-text('name: shop-nginx-cache')").waitFor();
  await save.click();
  await page.waitForSelector(".name-volumes-dialog", { state: "detached" });
  await page.waitForSelector(":text('Saved compose.yml')");

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
