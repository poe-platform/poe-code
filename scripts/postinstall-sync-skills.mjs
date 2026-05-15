#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

if (process.env.CI === "1" || process.env.SKIP_SYNC_SKILLS === "1") {
  process.exit(0);
}

if (!existsSync(join(root, "scripts/sync-skills.ts"))) {
  process.exit(0);
}

const npmExecPath = process.env.npm_execpath;
const command = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const args = npmExecPath ? [npmExecPath, "run", "sync-skills"] : ["run", "sync-skills"];

const result = spawnSync(command, args, {
  cwd: root,
  env: { ...process.env, SYNC_SKILLS_SCOPE: "global" },
  stdio: "inherit",
  shell: false
});

if (result.error || result.status !== 0) {
  const reason = result.error?.message ?? `exit code ${result.status}`;
  console.error(`Warning: skill sync failed during postinstall (${reason}).`);
}
