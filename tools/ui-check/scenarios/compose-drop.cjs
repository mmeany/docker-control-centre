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

  // Several folders: a share WSL can't reach and a folder in another distro
  // are skipped, said in the first confirm (no second dialog); the rest come
  // in turn.
  await drop(["\\\\nas\\share\\app", "\\\\wsl.localhost\\Debian\\home\\x", "E:\\projects\\alpha", "E:\\projects\\beta"]);
  await page.waitForSelector(".drop-dialog:has-text('(1 of 2)'):has-text('Project: alpha')");
  await page.waitForSelector(".drop-dialog .drop-skipped:has-text('not network shares')");
  await page.waitForSelector(".drop-dialog .drop-skipped:has-text('is in Debian, but compose runs in Ubuntu-Dev')");
  if (await page.$("[role=alertdialog]")) throw new Error("skipped folders belong in the confirm, not a second dialog");
  await shot("drop-skipped");
  await page.click(".drop-dialog .btn:has-text('Skip')");
  await page.waitForSelector(".drop-dialog:has-text('(2 of 2)'):has-text('Project: beta')");
  if (await page.$(".drop-skipped")) throw new Error("the skipped note shows in the first confirm only");
  await page.click(".drop-dialog .btn:has-text('Cancel')");
  await page.waitForSelector(".drop-dialog", { state: "detached" });

  // The next confirm waits for the last project's up: with a slow pin, Start
  // on alpha shows no confirm for beta until alpha's run has finished, and
  // the run is alpha's.
  await page.evaluate(() => {
    const pin = window.__mock.compose_pin;
    window.__mock.compose_pin = (a) => new Promise((r) => setTimeout(() => r(window.__handlers.compose_pin(a)), 600));
    window.__restorePin = () => (window.__mock.compose_pin = pin);
  });
  await drop(["E:\\projects\\alpha", "E:\\projects\\beta"]);
  await page.waitForSelector(".drop-dialog:has-text('Project: alpha')");
  await page.click(".drop-dialog .btn:has-text('Start')");
  await page.waitForSelector(".drop-dialog", { state: "detached" });
  await page.waitForTimeout(300); // still pinning alpha
  if (await page.$(".drop-dialog")) throw new Error("beta's confirm showed while alpha was still pinning");
  // A drop now is ignored: alpha's turn isn't over.
  await drop(["E:\\projects\\gamma"]);
  await page.waitForSelector(".run-output:has-text('docker compose -p alpha up')");
  if (!(await page.$(".dialog-title:has-text('alpha')"))) throw new Error("the run dialog should be alpha's");
  await page.waitForSelector(".dialog .ok-note:has-text('Finished')");
  await page.click(".dialog .btn:has-text('Close')");
  await page.waitForSelector(".address-bar:has-text('alpha')");
  await page.waitForSelector(".drop-dialog:has-text('(2 of 2)'):has-text('Project: beta')");
  await page.click(".drop-dialog .btn:has-text('Cancel')");
  await page.waitForSelector(".drop-dialog", { state: "detached" });
  if (await page.$(".drop-dialog:has-text('gamma')")) throw new Error("a drop during alpha's turn should be ignored");
  await page.evaluate(() => window.__restorePin());

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
  await page.waitForSelector(".dialog", { state: "detached" });

  // With a dialog open (Settings) over Files, a drop does nothing at all.
  await page.click(".cmd-btn:has-text('Settings')");
  await page.waitForSelector("[role=dialog]");
  await drop(["E:\\projects\\wiki\\compose.yml"]);
  await page.waitForTimeout(200);
  if (await page.$(".dialog:has-text('Copy into')")) throw new Error("a drop while a dialog is open should be ignored, claimed or not");
  await page.click("[role=dialog] .btn:has-text('Cancel')");
  await page.waitForSelector("[role=dialog]", { state: "detached" });

  // Back out of Files: drops start projects again.
  await page.keyboard.press("Control+l");
  await page.fill(".address-input", "/compose");
  await page.keyboard.press("Enter");
  await drop(["E:\\projects\\wiki"]);
  await page.waitForSelector(".drop-dialog");
  await page.keyboard.press("Escape");

  // A pop-out shows its one place: compose drops do nothing there (no
  // overlay, no confirm).
  await page.goto(`${page.url().split("?")[0]}?popout=${encodeURIComponent("/compose/shop/logs")}`);
  await page.waitForSelector(".log-src:has-text('api')");
  await page.evaluate(() => window.__dragOver(["E:\\projects\\wiki"]));
  await page.waitForTimeout(200);
  if (await page.$(".drop-overlay")) throw new Error("no drop overlay in a pop-out");
  await drop(["E:\\projects\\wiki"]);
  await page.waitForTimeout(300);
  if (await page.$(".drop-dialog")) throw new Error("a pop-out should ignore compose drops");
  if (!(await page.$(".log-src:has-text('api')"))) throw new Error("the pop-out should stay on its place");
};
