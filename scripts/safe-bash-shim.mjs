#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const distEntry = path.join(repoRoot, "dist", "bin", "safe-bash.js");

if (fs.existsSync(distEntry)) {
  try {
    await import(pathToFileURL(distEntry).href);
    process.exit(process.exitCode ?? 0);
  } catch {
    // Fall back to tsx loader when dist/ is incomplete
  }
}

const tsxLoader = pathToFileURL(path.join(repoRoot, "node_modules", "tsx", "dist", "loader.mjs")).href;
const srcEntry = path.join(repoRoot, "src", "cli", "safe-bash-entry.ts");
const res = spawnSync(process.execPath, ["--import", tsxLoader, srcEntry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env
});
process.exit(res.status ?? 1);
