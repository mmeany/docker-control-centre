# Docker Control Centre

A desktop app built with Tauri 2, React and Rust.

See `CLAUDE.md` for the architecture, the rules, and how to add a section.

## Prerequisites (developer machine only)

- Node.js 20+ (LTS)
- Rust (stable, MSVC toolchain on Windows) + Microsoft C++ Build Tools
- WebView2: already part of Windows 10/11

End users need none of these: the built app is a single native executable.

## Run

```
npm install
npm run tauri dev
```

The first build compiles the Rust dependencies and takes a few minutes; later
builds are incremental.

## Check the UI without the native app

```
npm i -D playwright && npx playwright install chromium   # once
npm run ui:check -- --both
```

This runs the scenarios in `tools/ui-check/scenarios` against the Vite dev
server, with the Tauri IPC mocked by `tools/ui-check/mock-ipc.js`. Screenshots
go to `tools/ui-check/out/`. The check fails on console errors or on commands
with no mock.

## Build a distributable

```
npm run tauri build
```

| Output | Use |
|---|---|
| `src-tauri\target\release\bundle\nsis\<Name>_<version>_x64-setup.exe` | Installer: Start menu entry and uninstaller; no admin rights needed by default |
| `src-tauri\target\release\bundle\msi\<Name>_<version>_x64_en-US.msi` | MSI installer, for IT / Group Policy deployment |
| `src-tauri\target\release\<slug>.exe` | The app as a single file; runs without installing |

To build only the setup program: `npm run tauri build -- --bundles nsis`.

- **Not code-signed:** Windows SmartScreen warns on first run (More info →
  Run anyway). Signing needs a certificate, configured under
  `bundle.windows` in `src-tauri/tauri.conf.json`.
- **Version:** `version` in `src-tauri/tauri.conf.json`. Raise it for each
  release so installers upgrade cleanly.
- **Before a release:** run `cargo audit` in `src-tauri`.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Enter / double-click | Open |
| Backspace, Alt+↑ | Up one level |
| Alt+← / Alt+→ | Back / forward |
| F5 | Refresh |
| Ctrl+A | Select all |
