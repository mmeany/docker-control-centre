// In-app help (M13): the ? button (end of the command bar) and F1 in Explorer, General help and Back,
// a view's topic, F1 inside a terminal (it doesn't reach the shell), a
// dialog's topic over the dialog (Esc closes only the help), the Help menu,
// the dashboard's topics, Connecting while disconnected, and a pop-out.
module.exports = async (page, { shot }) => {
  await page.waitForSelector(".status-bar:has-text('ubuntu-dev · tcp://localhost:2375')");
  const go = async (address) => {
    await page.keyboard.press("Control+l");
    await page.fill(".address-input", address);
    await page.keyboard.press("Enter");
  };
  const helpIs = (title) => page.waitForSelector(`.help-dialog .dialog-title:has-text('Help: ${title}')`);
  const closeHelp = async () => {
    await page.keyboard.press("Escape");
    await page.waitForSelector(".help-dialog", { state: "detached" });
  };

  // Explorer, Home: the ? button.
  await page.click(".command-bar .help-btn");
  await helpIs("Home");
  await shot("explorer-home");
  await page.click(".help-dialog .btn:has-text('General help')");
  await helpIs("Docker Control Centre");
  await page.waitForSelector(".help-dialog td:has-text('Help for the current view or dialog')");
  await page.click(".help-dialog .btn:has-text('Back to Home')");
  await helpIs("Home");
  await closeHelp();

  // F1 on the containers list; a second F1 doesn't stack another dialog.
  await page.click(".tree-row:has-text('Containers')");
  await page.waitForSelector(".fl-row:has-text('monitoring')");
  await page.keyboard.press("F1");
  await helpIs("Containers");
  await page.keyboard.press("F1");
  if ((await page.$$(".help-dialog")).length !== 1) throw new Error("F1 with help open should do nothing");
  await closeHelp();

  // A detail view.
  await go("/containers/@shop/shop-web-1/logs");
  await page.waitForSelector(".log-line:has-text('GET /health')");
  await page.keyboard.press("F1");
  await helpIs("Logs");
  await shot("logs");
  await closeHelp();

  // F1 in a terminal opens help and isn't sent to the shell.
  await go("/containers/postgres/terminal");
  await page.waitForSelector(".xterm-rows:has-text('root@')");
  await page.click(".terminal-host");
  await page.keyboard.press("F1");
  await helpIs("Terminal");
  await closeHelp();
  const sent = await page.evaluate(() => window.__calls.filter((c) => c[0] === "terminal_input").map((c) => c[1].data).join(""));
  if (sent.includes("\x1bOP")) throw new Error("F1 reached the shell");

  // A dialog's topic wins over the view; Esc closes only the help.
  await page.click(".cmd-btn:has-text('Settings')");
  await page.waitForSelector(".dialog:has-text('Run docker compose')");
  await page.keyboard.press("F1");
  await helpIs("Settings");
  await shot("settings");
  await closeHelp();
  if (!(await page.$(".dialog:has-text('Run docker compose')"))) throw new Error("Esc in help closed Settings too");
  await page.click(".dialog .dialog-help");
  await helpIs("Settings");
  await closeHelp();
  await page.click(".dialog .btn:has-text('Cancel')");

  // The Help menu: this view, and general help.
  await page.click(".cmd-btn:has-text('Help')");
  await page.click(".cm-item:has-text('Help for this view')");
  await helpIs("Terminal");
  await closeHelp();
  await page.click(".cmd-btn:has-text('Help')");
  await page.click(".cm-item:has-text('General help')");
  await helpIs("Docker Control Centre");
  if (await page.$(".help-dialog .btn:has-text('General help')")) throw new Error("General help shouldn't offer itself");
  await closeHelp();

  // Dashboard: the list topics are its own; detail views share Explorer's.
  await page.click(".cmd-btn:has-text('Dashboard')");
  await page.waitForSelector(".dash .dash-title:has-text('Terminal')");
  await page.click(".dash-commands .help-btn");
  await helpIs("Terminal");
  await closeHelp();
  await page.click(".dash-nav-item:has-text('Containers')");
  await page.waitForSelector(".bd-row.parent:has-text('shop')");
  await page.click(".dash-commands .help-btn");
  await helpIs("Containers");
  await page.waitForSelector(".help-dialog:has-text('Tick rows')");
  await shot("dashboard-containers");
  await page.click(".help-dialog .btn:has-text('General help')");
  await page.waitForSelector(".help-dialog:has-text('side panel')");
  await closeHelp();
  await page.click(".dash-nav-item:has-text('Overview')");
  await page.keyboard.press("F1");
  await helpIs("Overview");
  await closeHelp();
  // The Overview has no command bar: its ? is in the header.
  await page.click(".dash-header .help-btn");
  await helpIs("Overview");
  await closeHelp();

  // Disconnected: the Connecting topic, wherever you are.
  await page.evaluate(() => window.__engine({ type: "disconnected", message: "Connection refused" }));
  await page.waitForSelector(".status-bar:has-text('Not connected')");
  await page.keyboard.press("F1");
  await helpIs("Connecting to Docker");
  await shot("connecting");
  await closeHelp();
  await page.evaluate(() => window.__engine({ type: "connected" }));

  // A pop-out: the ? in its status bar, Explorer topics.
  const base = page.url().split("?")[0];
  await page.goto(`${base}?popout=${encodeURIComponent("/containers/postgres/stats")}`);
  await page.waitForSelector(".app.popout .status-bar:has-text('ubuntu-dev')");
  await page.click(".status-end .help-btn");
  await helpIs("Stats");
  await shot("popout");
  await closeHelp();
};
