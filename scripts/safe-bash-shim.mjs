#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, "..");
const distSafeBash = path.join(rootDir, "dist", "safe-bash.js");
const distCliSafeBash = path.join(rootDir, "dist", "cli", "safe-bash-main.js");

if (fs.existsSync(distCliSafeBash)) {
  const mod = await import(pathToFileURL(distCliSafeBash).href);
  await mod.safeBashMain();
} else if (fs.existsSync(distSafeBash)) {
  const mod = await import(pathToFileURL(distSafeBash).href);
  if (typeof mod.safeBashMain === "function") {
    await mod.safeBashMain();
  }
} else {
  const tsxBin = path.join(rootDir, "node_modules", ".bin", "tsx");
  const entry = path.join(rootDir, "src", "cli", "safe-bash-entry.ts");
  const res = spawnSync(tsxBin, [entry, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
    cwd: process.cwd()
  });
  process.exit(res.status ?? 1);
}
