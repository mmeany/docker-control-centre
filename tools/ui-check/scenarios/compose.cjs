// Compose: running and pinned projects, up with streamed output, merged logs,
// pinning, the down confirmation, and Settings.
module.exports = async (page, { shot }) => {
  await page.waitForSelector(".status-bar:has-text('ubuntu-dev · tcp://localhost:2375')");
  // Pinned projects that are down show from "Running and stopped".
  await page.selectOption("#tree-level", "stopped");
  await page.click(".tree-row:has-text('Compose')");
  await page.waitForSelector(".fl-row:has-text('blog') >> text=Down");
  await page.waitForSelector(".fl-row:has-text('Ubuntu-Dev')"); // WSL paths shown as Windows ones
  await shot("projects");

  // Up: output streams in, then Finished.
  await page.click(".fl-row:has-text('shop')");
  await page.click(".cmd-btn:has-text('Up')");
  await page.waitForSelector(".run-output:has-text('docker compose -p shop up')");
  await page.waitForSelector(".dialog .ok-note:has-text('Finished')");
  if (await page.$(".run-output .err")) throw new Error("compose progress shouldn't look like errors");
  await shot("up");
  await page.click(".dialog .btn:has-text('Close')");

  // Merged logs: every service, labelled.
  await page.dblclick(".fl-row:has-text('shop')");
  await page.dblclick(".fl-row:has-text('Logs')");
  await page.waitForSelector(".log-src:has-text('api')");
  await page.waitForSelector(".log-src:has-text('worker')");
  await shot("merged-logs");

  // Pin a file: it appears, down.
  await page.click(".cmd-btn:has-text('Pin file')");
  await page.waitForSelector(".tree-row:has-text('wiki')");

  // Down asks first; volumes need the name typed.
  await page.click(".tree-row:has-text('Compose')");
  await page.click(".fl-row:has-text('shop')");
  await page.click(".cmd-btn:has-text('Down')");
  await page.click(".dialog .btn:has-text('Down and delete volumes')");
  await page.waitForSelector(".dialog:has-text('Type shop to confirm')");
  await page.keyboard.press("Escape");

  // Settings: distros listed, test runs compose version.
  await page.click(".cmd-btn:has-text('Settings')");
  // Options in a closed <select> are never "visible": wait for them to exist.
  await page.waitForSelector("#distro option:has-text('Ubuntu-Dev')", { state: "attached" });
  await page.click(".dialog .btn:has-text('Test')");
  await page.waitForSelector(".dialog .ok-note:has-text('Docker Compose version')");
  await shot("settings");
};
