// Logs (search, timestamps), terminal, stats and pop-out windows.
module.exports = async (page, { shot }) => {
  await page.waitForSelector(".status-bar:has-text('ubuntu-dev · tcp://localhost:2375')");
  const go = async (address) => {
    await page.keyboard.press("Control+l");
    await page.fill(".address-input", address);
    await page.keyboard.press("Enter");
  };

  // Logs: lines stream in, search finds and jumps, timestamps show.
  await go("/containers/@shop/shop-web-1/logs");
  await page.waitForSelector(".log-line:has-text('GET /health')");
  await page.fill(".logs-search", "error");
  await page.press(".logs-search", "Enter");
  await page.waitForSelector(".filter-bar:has-text('of 9')");
  await page.waitForSelector(".log-line.current mark");
  await page.check(".logs-bar input[type=checkbox] >> nth=0");
  await page.waitForSelector(".log-time");
  await shot("logs");

  // Terminal: typing reaches the shell; Ctrl+L goes to the shell, not the address bar.
  await go("/containers/postgres/terminal");
  await page.waitForSelector(".xterm-rows:has-text('root@')");
  await page.click(".terminal-host");
  await page.keyboard.type("ls");
  await page.keyboard.press("Control+l");
  if (await page.$(".address-input")) throw new Error("Ctrl+L in the terminal opened the address bar");
  const sent = await page.evaluate(() => window.__calls.filter((c) => c[0] === "terminal_input").map((c) => c[1].data).join(""));
  if (!sent.includes("ls") || !sent.includes("\f")) throw new Error(`terminal input was ${JSON.stringify(sent)}`);
  await shot("terminal");

  // Stats: tiles fill in.
  await page.click(".tree-row:has-text('postgres')");
  await page.dblclick(".fl-row:has-text('Stats')");
  await page.waitForSelector(".stats-tile:has-text('CPU')");
  await page.waitForTimeout(2200);
  await shot("stats");

  // Pop out asks Rust for a window at this address; leaving stops the stream.
  await page.click(".btn:has-text('Pop out')");
  await page.waitForFunction(() => (window.__popouts || []).some((p) => p.address === "/containers/postgres/stats"));
  await page.click(".tool-btn[title^='Up']");
  await page.waitForFunction(() => window.__calls.some((c) => c[0] === "stop_stream"));
};
