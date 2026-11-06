// Checks that package.json, src-tauri/Cargo.toml and src-tauri/tauri.conf.json
// carry the same version, and, given a tag (v1.2.3), that it matches too.
//   node scripts/check-version.mjs          (CI)
//   node scripts/check-version.mjs v0.1.0   (release)
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

const versions = {
  "package.json": JSON.parse(read("package.json")).version,
  "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
  "src-tauri/Cargo.toml": /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(read("src-tauri/Cargo.toml"))?.[1],
};

const tag = process.argv[2];
if (tag) versions[`tag ${tag}`] = tag.replace(/^refs\/tags\//, "").replace(/^v/, "");

const distinct = new Set(Object.values(versions));
if (distinct.size !== 1 || distinct.has(undefined)) {
  console.error("Versions don't match:");
  for (const [k, v] of Object.entries(versions)) console.error(`  ${k}: ${v ?? "(not found)"}`);
  process.exit(1);
}
console.log(`Version ${[...distinct][0]} everywhere${tag ? `, matching ${tag}` : ""}.`);
