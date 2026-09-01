#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export function createPostinstallSkillSyncPlan(options = {}) {
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const execPath = options.execPath ?? process.execPath;
  const platform = options.platform ?? process.platform;
  const repoRoot = options.root ?? root;

  if (env.CI && env.CI !== "0" && env.CI !== "false") {
    return { action: "skip", reason: "ci" };
  }
  if (env.SKIP_SYNC_SKILLS === "1") {
    return { action: "skip", reason: "disabled" };
  }

  const syncScript = join(repoRoot, "scripts/sync-skills.ts");
  if (!exists(syncScript)) {
    return { action: "skip", reason: "missing-sync-script" };
  }

  const tsxCli = join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const useDirectSync =
    env.POE_CODE_POSTINSTALL_FORCE_NPM !== "1" && exists(tsxCli);
  const npmExecPath = env.npm_execpath;
  const command = useDirectSync
    ? execPath
    : npmExecPath
      ? execPath
      : platform === "win32"
        ? "npm.cmd"
        : "npm";
  const args = useDirectSync
    ? [tsxCli, syncScript]
    : npmExecPath
      ? [npmExecPath, "run", "sync-skills"]
      : ["run", "sync-skills"];

  return {
    action: "spawn",
    command,
    args,
    options: {
      cwd: repoRoot,
      env: { ...env, SYNC_SKILLS_SCOPE: "global" },
      stdio: "inherit",
      shell: false
    }
  };
}

export function runPostinstallSkillSync(options = {}) {
  const plan = createPostinstallSkillSyncPlan(options);
  if (plan.action === "skip") {
    return { plan };
  }

  const spawn = options.spawn ?? spawnSync;
  const warn = options.warn ?? console.error;
  const result = spawn(plan.command, plan.args, plan.options);

  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? `exit code ${result.status}`;
    warn(`Warning: skill sync failed during postinstall (${reason}).`);
  }

  return { plan, result };
}

function isMain() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMain()) {
  runPostinstallSkillSync();
}
