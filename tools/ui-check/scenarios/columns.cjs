// Resizable list columns: drag a header edge, double-click to fit, the last
// column fills the pane, sideways scroll, reset from the header menu, and the
// widths remembered in settings values.
module.exports = async (page, { shot }) => {
  await page.waitForSelector(".status-bar:has-text('ubuntu-dev · tcp://localhost:2375')");
  await page.click(".tree-row:has-text('Images')");
  await page.waitForSelector(".fl-row");

  const headWidth = (label) =>
    page.$eval(`.fl-head-wrap[data-col='${label}']`, (el) => Math.round(el.getBoundingClientRect().width));
  const handle = async (label) => {
    const box = await page.locator(`.fl-head-wrap[data-col='${label}'] .fl-resize`).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  // The last column fills the pane: its right edge is the list's.
  const last = await page.$eval(".fl-head-row", (row) => {
    const cells = row.querySelectorAll(".fl-head-wrap");
    return Math.round(row.getBoundingClientRect().right - cells[cells.length - 1].getBoundingClientRect().right);
  });
  if (Math.abs(last) > 1) throw new Error(`last column doesn't reach the edge (${last}px short)`);

  // Drag Name's edge 120px to the right.
  const before = await headWidth("name");
  const h = await handle("name");
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(h.x + 60, h.y, { steps: 4 });
  await page.mouse.move(h.x + 120, h.y, { steps: 4 });
  await page.mouse.up();
  const after = await headWidth("name");
  if (Math.abs(after - before - 120) > 2) throw new Error(`Name went from ${before} to ${after}, not +120`);
  // Rows follow the header.
  const cell = await page.$eval(".fl-row > :first-child", (el) => Math.round(el.getBoundingClientRect().width));
  if (Math.abs(cell - after) > 1) throw new Error(`row cell ${cell} doesn't match header ${after}`);
  const saved = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("get_settings").then((s) => s.values["columns.images"]));
  if (saved?.widths?.name !== after) throw new Error(`not remembered: ${JSON.stringify(saved)}`);
  await shot("resized");

  // Double-click Size's edge: fits its header and cells (narrow).
  const sh = await handle("size");
  await page.mouse.dblclick(sh.x, sh.y);
  const size = await headWidth("size");
  if (size >= 90 || size < 40) throw new Error(`Size fitted to ${size}`);

  // Widen Created past the pane: the list scrolls sideways, header in step.
  const th = await handle("created");
  await page.mouse.move(th.x, th.y);
  await page.mouse.down();
  await page.mouse.move(th.x + 500, th.y, { steps: 6 });
  await page.mouse.up();
  const scroll = await page.$eval(".fl-body", (el) => {
    el.scrollLeft = 300;
    return el.scrollWidth > el.clientWidth;
  });
  if (!scroll) throw new Error("no sideways scroll");
  await page.waitForTimeout(50);
  const headLeft = await page.$eval(".fl-header", (el) => el.scrollLeft);
  if (Math.abs(headLeft - 300) > 1) throw new Error(`header scrolled to ${headLeft}`);
  await shot("scrolled");

  // Sorting still works from the header (a click, not a drag).
  await page.click(".fl-head-wrap[data-col='size'] .fl-head-cell");
  await page.waitForSelector(".fl-head-wrap[data-col='size'] .sort-arrow");

  // Reset from the header menu.
  await page.click(".fl-head-wrap[data-col='name'] .fl-head-cell", { button: "right" });
  await page.waitForTimeout(50);
  const [hl, bl] = await page.evaluate(() => [document.querySelector(".fl-header").scrollLeft, document.querySelector(".fl-body").scrollLeft]);
  if (Math.abs(hl - bl) > 1) throw new Error(`header at ${hl}, rows at ${bl}`);
  await shot("header-menu");
  await page.click(".cm-item:has-text('Reset column widths')");
  if ((await headWidth("name")) !== before) throw new Error("reset didn't restore Name");
  const cleared = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("get_settings").then((s) => s.values["columns.images"]));
  if (cleared !== undefined) throw new Error("reset didn't remove the value");
};
