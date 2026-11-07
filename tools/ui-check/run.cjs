#!/usr/bin/env node
// UI check harness: runs the frontend in headless Chromium with the Tauri IPC
// mocked (mock-ipc.js), plays a scenario and saves screenshots to ./out.
// Nothing here ships with the app.
//
//   npm run ui:check                      every scenario, dark theme
//   npm run ui:check -- smoke --light     one scenario, light theme
//   npm run ui:check -- smoke --both      both themes
//
// Needs Playwright once per machine (not a project dependency):
//   npm i -D playwright && npx playwright install chromium
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const ROOT = path.resolve(__dirname, "../..");
const URL = "http://localhost:1420";
const OUT = path.join(__dirname, "out");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright isn't installed. Run:\n  npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}

const args = process.argv.slice(2);
const themes = args.includes("--both") ? ["dark", "light"] : args.includes("--light") ? ["light"] : ["dark"];
const wanted = args.filter((a) => !a.startsWith("--"));
const scenarioDir = path.join(__dirname, "scenarios");
const scenarios = fs
  .readdirSync(scenarioDir)
  .filter((f) => f.endsWith(".cjs"))
  .map((f) => f.replace(/\.cjs$/, ""))
  .filter((n) => wanted.length === 0 || wanted.includes(n));
if (scenarios.length === 0) {
  console.error(`No scenario matches ${wanted.join(", ")} (see tools/ui-check/scenarios).`);
  process.exit(2);
}

const up = () =>
  new Promise((resolve) => {
    http.get(URL, (r) => (r.resume(), resolve(true))).on("error", () => resolve(false));
  });

const isWin = process.platform === "win32";

/** Stops the dev server and everything it started (npx, then vite). */
function stopServer(child) {
  if (!child) return;
  try {
    if (isWin) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-child.pid);
  } catch {
    /* already gone */
  }
}

async function ensureDevServer() {
  if (await up()) {
    console.log(`Using the dev server already running at ${URL} (make sure it's this project's).`);
    return null;
  }
  const child = spawn(isWin ? "npx.cmd" : "npx", ["vite", "--port", "1420", "--strictPort"], {
    cwd: ROOT,
    stdio: "ignore",
    shell: isWin,
    detached: !isWin, // own process group, so stopServer can end vite too
  });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await up()) return child;
  }
  stopServer(child);
  throw new Error("The Vite dev server didn't start on port 1420.");
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await ensureDevServer();
  const mockSource = fs.readFileSync(path.join(__dirname, "mock-ipc.js"), "utf8");
  const { version } = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));
  const browser = await chromium.launch();
  let failures = 0;
  try {
    for (const name of scenarios) {
      for (const theme of themes) {
        const page = await browser.newPage({ viewport: { width: 1200, height: 720 } });
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
        await page.addInitScript({
          content: `window.__UI_CHECK_THEME__ = ${JSON.stringify(theme)};\nwindow.__APP_VERSION__ = ${JSON.stringify(version)};\n${mockSource}`,
        });
        await page.goto(URL);
        const shot = async (label) => {
          const file = path.join(OUT, `${name}-${label}-${theme}.png`);
          await page.screenshot({ path: file });
          console.log(`  saved ${path.relative(ROOT, file)}`);
        };
        console.log(`${name} (${theme})`);
        try {
          await require(path.join(scenarioDir, `${name}.cjs`))(page, { shot, theme });
        } catch (e) {
          errors.push(`scenario failed: ${e.message.split("\n")[0]}`);
          await shot("failure").catch(() => {});
        }
        if (errors.length) {
          failures++;
          console.log(`  ${errors.length} problem(s):\n    ${errors.join("\n    ")}`);
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
    stopServer(server);
  }
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
