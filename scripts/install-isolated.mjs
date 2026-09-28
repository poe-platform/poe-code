import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

// Run before npm, since lifecycle hooks run after dependency tree mutations.
export function installIsolated(options = {}) {
  const root = options.root ?? fileURLToPath(new URL("..", import.meta.url));
  const filesystem = options.fs ?? fs;
  const modules = path.join(root, "node_modules");
  let stat;
  try {
    stat = filesystem.lstatSync(modules);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (stat?.isSymbolicLink()) filesystem.unlinkSync(modules);

  const result = (options.spawn ?? spawnSync)(options.npm ?? "npm", ["ci", ...(options.args ?? [])], {
    cwd: root,
    stdio: "inherit",
    shell: false
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = installIsolated({ args: process.argv.slice(2) });
}
