// Files inside a container: browse with addresses, Up, the archive fallback
// for a stopped container, and copying a file in.
module.exports = async (page, { shot }) => {
  await page.waitForSelector(".status-bar:has-text('ubuntu-dev · tcp://localhost:2375')");
  const go = async (address) => {
    await page.keyboard.press("Control+l");
    await page.fill(".address-input", address);
    await page.keyboard.press("Enter");
  };

  await go("/containers/@shop/shop-web-1/files/etc");
  await page.waitForSelector(".fl-row:has-text('hosts')");
  if (await page.$(".files-note")) throw new Error("a running container with a shell lists via exec: no note");
  await page.dblclick(".fl-row:has-text('nginx')");
  await page.waitForSelector(".address-bar:has-text('nginx')");
  await page.waitForSelector(".fl-row:has-text('nginx.conf')");
  await shot("files");
  await page.click(".tool-btn[title^='Up']");
  await page.waitForSelector(".fl-row:has-text('passwd')");

  // Stopped container: read from the archive API, and says so.
  await go("/containers/redis-scratch/files");
  await page.waitForSelector(".files-note:has-text('archive API')");

  // Copy a file in (the mocked picker returns E:\projects\wiki\compose.yml).
  await page.click(".btn:has-text('Copy file in')");
  await page.waitForSelector(".dialog:has-text('Copy into /')");
  await page.click(".dialog .btn.primary");
  await page.waitForSelector(".status-bar:has-text('Copied 1 file into /')");
  await page.waitForSelector(".fl-row:has-text('compose.yml')");
  await shot("files-copied-in");
};
