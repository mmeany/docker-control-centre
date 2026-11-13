// Anonymous volumes: the volumes list names one by who mounts it, and a
// container's Mounts view says why Docker made it.
module.exports = async (page, { shot }) => {
  await page.waitForSelector(".status-bar:has-text('ubuntu-dev · tcp://localhost:2375')");
  const go = async (address) => {
    await page.keyboard.press("Control+l");
    await page.fill(".address-input", address);
    await page.keyboard.press("Enter");
  };

  // The volumes list: mounted by postgres, so named after it; the unmounted one by its hash.
  await go("/volumes");
  const cell = page.locator(".fl-name:has-text('postgres:/var/lib/postgresql/data (anonymous)')");
  await cell.waitFor();
  if (!/^[0-9a-f]{64} · /.test((await cell.getAttribute("title")) ?? "")) throw new Error(`no hash tooltip: ${await cell.getAttribute("title")}`);
  await page.waitForSelector(".fl-cell:has-text('… (anonymous)')");
  await shot("volumes-anonymous");

  // The container's Mounts view.
  await go("/containers/postgres/mounts");
  await page.waitForSelector(".hint:has-text('Anonymous volumes have no name')");
  await page.waitForSelector(".data-table th:has-text('Unnamed')");
  const why = page.locator(".data-table td span:text-is('Image VOLUME')");
  await why.waitFor();
  if (!(await why.getAttribute("title"))?.includes("declares this path as a VOLUME")) throw new Error("no cause tooltip");
  await shot("mounts-anonymous");
};
