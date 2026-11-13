// Resizable inspect tables: auto-sized until the first drag, then fixed and
// remembered per kind of table; double-click fits; header right-click resets
// to auto. Settings › Reset all column layouts clears every list and table.
module.exports = async (page, { shot }) => {
  await page.waitForSelector(".status-bar:has-text('ubuntu-dev · tcp://localhost:2375')");
  const value = (key) => page.evaluate((k) => window.__TAURI_INTERNALS__.invoke("get_settings").then((s) => s.values[k]), key);
  const th = (id) => page.locator(`.data-table th[data-col='${id}']`);
  const width = async (id) => Math.round((await th(id).boundingBox()).width);
  const edge = async (id) => {
    const b = await page.locator(`.data-table th[data-col='${id}'] .fl-resize`).boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };

  await page.keyboard.press("Control+l");
  await page.fill(".address-input", "/containers/postgres/env");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".data-table.resizable th[data-col='name']");
  if (await page.$(".data-table.fixed")) throw new Error("table fixed before any drag");

  // Drag Name 80px wider: the table freezes, Value fills the rest.
  const before = await width("name");
  const h = await edge("name");
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(h.x + 40, h.y, { steps: 3 });
  await page.mouse.move(h.x + 80, h.y, { steps: 3 });
  await page.mouse.up();
  await page.waitForSelector(".data-table.fixed");
  const after = await width("name");
  if (Math.abs(after - before - 80) > 2) throw new Error(`Name went from ${before} to ${after}, not +80`);
  const [tableR, valueR] = await page.evaluate(() => [
    Math.round(document.querySelector(".data-table").getBoundingClientRect().right),
    Math.round(document.querySelector(".data-table th[data-col='value']").getBoundingClientRect().right),
  ]);
  if (Math.abs(tableR - valueR) > 1) throw new Error("last column doesn't fill the table");
  const saved = await value("columns.table.env");
  if (saved?.widths?.name !== after || saved?.widths?.value === undefined) throw new Error(`not remembered: ${JSON.stringify(saved)}`);
  await shot("env-resized");

  // Double-click fits Name to its longest entry (POSTGRES_PASSWORD).
  const n = await edge("name");
  await page.mouse.dblclick(n.x, n.y);
  const fitted = await width("name");
  const need = await page.$$eval(".data-table tbody tr td:first-child", (tds) =>
    Math.max(...tds.map((td) => { const r = document.createRange(); r.selectNodeContents(td); return r.getBoundingClientRect().width; })),
  );
  if (fitted < need || fitted > need + 30) throw new Error(`fit gave ${fitted} for content ${Math.round(need)}`);

  // Another container's env shares the widths.
  await page.keyboard.press("Control+l");
  await page.fill(".address-input", "/containers/@shop/shop-web-1/env");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".data-table.fixed th[data-col='name']");
  if ((await width("name")) !== fitted) throw new Error("env widths not shared between containers");

  // Header right-click: Reset column widths goes back to auto.
  await th("name").click({ button: "right" });
  await page.click(".cm-item:has-text('Reset column widths')");
  await page.waitForSelector(".data-table.resizable:not(.fixed)");
  if ((await value("columns.table.env")) !== undefined) throw new Error("reset didn't remove the value");

  // Settings › Reset all column layouts: lists and tables alike.
  const e2 = await edge("name");
  await page.mouse.move(e2.x, e2.y);
  await page.mouse.down();
  await page.mouse.move(e2.x + 50, e2.y, { steps: 3 });
  await page.mouse.up();
  await page.click(".tree-row:has-text('Images')");
  await page.waitForSelector(".fl-head-wrap[data-col='id']");
  await page.click(".fl-head-wrap[data-col='name'] .fl-head-cell", { button: "right" });
  await page.click(".cm-item:has-text('Image ID')");
  await page.waitForSelector(".fl-head-wrap[data-col='id']", { state: "detached" });
  if (!(await value("columns.table.env")) || !(await value("columns.images"))) throw new Error("layouts not saved before reset");

  await page.click(".cmd-btn:has-text('Settings')");
  await page.click(".dialog .btn:has-text('Reset all column layouts')");
  await page.waitForSelector(".dialog .warn-note:has-text('default column widths')");
  await shot("settings-reset");
  await page.click(".dialog .settings-columns .btn.danger");
  await page.waitForSelector(".dialog .hint:has-text('back to its default columns')");
  if ((await value("columns.table.env")) !== undefined || (await value("columns.images")) !== undefined) throw new Error("Settings reset left values");
  await page.keyboard.press("Escape");
  // The open list shows every column again straight away.
  await page.waitForSelector(".fl-head-wrap[data-col='id']");
};
