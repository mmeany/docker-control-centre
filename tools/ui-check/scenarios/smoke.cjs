// Smoke test of the shell and the sample section. Copy this file to add a
// scenario: each exports async (page, { shot, theme }) and uses Playwright.
module.exports = async (page, { shot }) => {
  await page.waitForSelector(".app");
  await page.waitForTimeout(300);
  await shot("home");
  // The rest exercises the sample section; skip it once that's removed.
  if (!(await page.$(".fl-row:has-text('Local files')"))) return;

  await page.dblclick(".fl-row:has-text('Local files')");
  await page.waitForSelector(".fl-row:has-text('Home folder')");
  await page.dblclick(".fl-row:has-text('Home folder')");
  await page.waitForSelector(".fl-row:has-text('Documents')");
  await shot("folder");

  await page.dblclick(".fl-row:has-text('Documents')");
  await page.waitForSelector(".fl-row:has-text('budget.csv')");
  await page.fill("#filter-input", "rep");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".status-bar:has-text('1 item (of 63)')");
  await page.dblclick(".fl-row:has-text('report.json')");
  await page.waitForSelector(".dialog:has-text('Quarterly report')");
  await shot("preview");
  await page.keyboard.press("Escape");

  await page.click(".fl-row:has-text('report.json')", { button: "right" });
  await page.waitForSelector(".context-menu");
  await shot("menu");
  await page.keyboard.press("Escape");
  await page.click(".tool-btn[title^='Back']");
  await page.waitForSelector(".fl-row:has-text('Projects')");
};
