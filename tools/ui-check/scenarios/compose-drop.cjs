// Dropping compose files and folders from Explorer: the overlay, the confirm
// (ticks, project name, broken files, name clashes), pin + up, then the
// project opens; several folders in turn; errors; container Files keeps
// its own drop (copy in).
module.exports = async (page, { shot }) => {
  await page.waitForSelector(".status-bar:has-text('ubuntu-dev · tcp://localhost:2375')");
  const drop = (paths) => page.evaluate((p) => window.__drop(p), paths);
  const ticked = () => page.$$eval(".drop-files tr", (rows) => rows.filter((r) => r.querySelector("input").checked).map((r) => r.querySelector("label").textContent));

  // Dragging over the window says what a drop does.
  await page.evaluate(() => window.__dragOver(["E:\\projects\\wiki"]));
  await page.waitForSelector(".drop-overlay:has-text('Drop a compose file or folder')");
  await shot("drop-overlay");
  await page.evaluate(() => window.__dragLeave());
  await page.waitForSelector(".drop-overlay", { state: "detached" });

  // A folder: base and override ticked, variants not; compose names it.
  await drop(["E:\\projects\\wiki"]);
  await page.waitForSelector(".drop-dialog:has-text('Project: wiki')");
  const first = await ticked();
  if (first.join() !== "compose.yml,compose.override.yml") throw new Error(`ticked ${first}`);
  await shot("drop-confirm");

  // A broken file: compose's message, and Start is off until it's unticked.
  await page.click(".drop-files label:has-text('compose-broken.yml')");
  await page.waitForSelector(".drop-dialog .warn-note:has-text('did not find expected node content')");
  if (!(await page.isDisabled(".drop-dialog .btn:has-text('Start')"))) throw new Error("Start should be off for files compose can't read");
  await page.click(".drop-files label:has-text('compose-broken.yml')");
  await page.waitForSelector(".drop-dialog:has-text('Project: wiki')");

  // Start: pinned with both files in order, up runs, then the project opens.
  await page.click(".drop-dialog .btn:has-text('Start')");
  await page.waitForSelector(".run-output:has-text('docker compose -p wiki up')");
  await page.waitForSelector(".dialog .ok-note:has-text('Finished')");
  const pins = await page.evaluate(() => window.__calls.filter(([c]) => c === "compose_pin").map(([, a]) => a.files));
  if (JSON.stringify(pins.at(-1)) !== JSON.stringify(["E:\\projects\\wiki\\compose.yml", "E:\\projects\\wiki\\compose.override.yml"])) throw new Error(`pinned ${JSON.stringify(pins)}`);
  await page.click(".dialog .btn:has-text('Close')");
  await page.waitForSelector(".address-bar:has-text('wiki')");
  await page.waitForSelector(".tree-row.selected:has-text('wiki')");

  // A dropped file whose project is already running: the confirm warns, and
  // the override beside it is offered.
  await drop(["E:\\projects\\shop\\compose.yml"]);
  await page.waitForSelector(".drop-dialog .warn-note:has-text('shop already exists')");
  const shop = await ticked();
  if (shop.join() !== "compose.yml,compose.override.yml") throw new Error(`ticked ${shop}`);
  await shot("drop-clash");
  await page.click(".drop-dialog .btn:has-text('Cancel')");
  await page.waitForSelector(".drop-dialog", { state: "detached" });

  // Several folders: a share WSL can't reach is refused, the rest come in turn.
  await drop(["\\\\nas\\share\\app", "E:\\projects\\alpha", "E:\\projects\\beta"]);
  await page.waitForSelector("[role=alertdialog]:has-text('not network shares')");
  await page.click("[role=alertdialog] .btn:has-text('OK')");
  await page.waitForSelector(".drop-dialog:has-text('(1 of 2)'):has-text('Project: alpha')");
  await page.click(".drop-dialog .btn:has-text('Skip')");
  await page.waitForSelector(".drop-dialog:has-text('(2 of 2)'):has-text('Project: beta')");
  await page.click(".drop-dialog .btn:has-text('Cancel')");
  await page.waitForSelector(".drop-dialog", { state: "detached" });

  // Not a compose file at all.
  await drop(["E:\\notes\\todo.txt"]);
  await page.waitForSelector("[role=alertdialog]:has-text('Drop a compose file')");
  await page.click("[role=alertdialog] .btn:has-text('OK')");

  // Container Files claims drops: they're copied in, not started.
  await page.keyboard.press("Control+l");
  await page.fill(".address-input", "/containers/@shop/shop-web-1/files/etc");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".fl-row:has-text('hosts')");
  await drop(["E:\\projects\\wiki\\compose.yml"]);
  await page.waitForSelector(".dialog:has-text('Copy into /etc')");
  if (await page.$(".drop-dialog")) throw new Error("Files should take the drop");
  await page.keyboard.press("Escape");

  // Back out of Files: drops start projects again.
  await page.keyboard.press("Control+l");
  await page.fill(".address-input", "/compose");
  await page.keyboard.press("Enter");
  await drop(["E:\\projects\\wiki"]);
  await page.waitForSelector(".drop-dialog");
  await page.keyboard.press("Escape");
};
