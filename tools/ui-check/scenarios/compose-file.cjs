// A project's compose files: one tab per file, line numbers and key colours,
// the Resolved tab fetched only when asked (and dropped on Hide), a missing
// file explained, and the way in from the Containers section.
module.exports = async (page, { shot }) => {
  await page.waitForSelector(".status-bar:has-text('ubuntu-dev · tcp://localhost:2375')");
  await page.selectOption("#tree-level", "stopped");

  // Open it from the project's list: a row beside Logs.
  await page.click(".tree-row:has-text('Compose')");
  await page.dblclick(".fl-row:has-text('shop')");
  await page.waitForSelector(".fl-row:has-text('Compose file') >> text=compose.yml, compose.override.yml");
  await page.dblclick(".fl-row:has-text('Compose file')");
  await page.waitForSelector(".code-view .code-key:has-text('services')");
  await page.waitForSelector(".code-view .code-comment:has-text('# Shop')");
  const where = await page.textContent(".compose-file-path");
  if (where !== String.raw`\\wsl.localhost\Ubuntu-Dev\home\mark\projects\shop\compose.yml`) throw new Error(`path shown as ${where}`);
  if (!(await page.textContent(".code-view")).includes("${DB_PASSWORD}")) throw new Error("the file shows variables as written");
  await shot("file");

  // The override has its own tab.
  await page.click(".compose-file-view .segmented button:has-text('compose.override.yml')");
  await page.waitForSelector(".code-view .code-comment:has-text('# dev only')");

  // Resolved: nothing is fetched until asked; Hide drops it.
  await page.click(".compose-file-view .segmented button:has-text('Resolved')");
  await page.waitForSelector(".compose-file-view:has-text('may contain secrets')");
  const asked = () => page.evaluate(() => window.__calls.filter((c) => c[0] === "compose_check" && c[1].verb === "config-yaml").length);
  if ((await asked()) !== 0) throw new Error("the resolved file was fetched before it was asked for");
  await page.click(".btn:has-text('Show resolved file')");
  await page.waitForSelector(".code-view:has-text('s3cret-from-env')");
  await shot("resolved");
  await page.click(".compose-file-view .btn:has-text('Hide')");
  await page.waitForSelector(".code-view", { state: "detached" });

  // Show in folder goes to Rust with the engine-side path.
  await page.click(".compose-file-view .segmented button:has-text('compose.yml') >> nth=0");
  await page.click(".btn:has-text('Show in folder')");
  const shown = await page.evaluate(() => window.__calls.filter((c) => c[0] === "compose_show_file").map((c) => c[1]));
  if (shown.length !== 1 || shown[0].how !== "folder" || shown[0].path !== "/home/mark/projects/shop/compose.yml") throw new Error(`show file got ${JSON.stringify(shown)}`);

  // A pinned file that has gone says so.
  await page.keyboard.press("Control+l");
  await page.fill(".address-input", "/compose/blog/file");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".error-panel:has-text('moved or been deleted')");
  if (!(await page.isDisabled(".btn:has-text('Show in folder')"))) throw new Error("a missing file can't be shown in its folder");
  await shot("missing");

  // From Containers: the project's menu.
  await page.click(".tree-row:has-text('Containers') >> nth=0");
  await page.click(".fl-row:has-text('shop')", { button: "right" });
  await page.click(".cm-item:has-text('Compose file')");
  await page.waitForSelector(".code-view .code-key:has-text('services')");
};
