import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkspaceBuildPlan } from "./build-workspaces.mjs";

// Deliberately select direct owners only. Build prerequisites remain the unit
// runner's responsibility; changing a package does not schedule its consumers.
export function packageChecks(plan, files, node22Workspaces) {
  const owners = new Map(plan.workspaces.map(workspace => [workspace.path, workspace]));
  const selected = new Set();
  let all = files === null;
  let root = all;
  let audit = all;
  for (const file of files ?? []) {
    if (file.startsWith("packages/")) {
      const owner = owners.get(file.split("/").slice(0, 2).join("/"));
      if (owner) selected.add(owner.name);
      // Removed workspaces and standalone Cargo crates have no npm unit task.
      else root = true;
    } else if (file.startsWith("docs/") || file.endsWith(".md") || file === "LICENSE") {
      continue;
    } else {
      root = true;
      if (["package.json", "package-lock.json", "turbo.json", "tests/setup.ts", "tests/test-env.ts"].includes(file)
        || file.startsWith("tsconfig") || file.startsWith("vitest.config")
        || ["scripts/build-workspaces.mjs", "scripts/check-cache.mjs", "scripts/test-vitest-workspaces.mjs",
          "scripts/workspace-test-ownership.mjs", "scripts/run-vitest-batch.mjs", "scripts/vitest-batch-worker.mjs"].includes(file)) all = true;
      if (["package.json", "package-lock.json", "eslint.config.js", "vitest.lint-stress.config.ts"].includes(file)
        || file.startsWith("scripts/lint-") || file === "scripts/run-lint-stress.mjs") audit = true;
    }
  }
  const groups = { packages: [], safe: [] };
  if (root || all) groups.packages.push({ workspace: ".", node: "24.22.3" });
  let bash = false;
  for (const workspace of plan.workspaces) {
    if (!all && !selected.has(workspace.name)) continue;
    if (!workspace.manifest.scripts?.["test:unit"]) continue;
    if (workspace.name === "@poe-platform/safe-bash") { bash = true; continue; }
    const group = workspace.path.startsWith("packages/safe-bash-") ? groups.safe : groups.packages;
    group.push({ workspace: workspace.name, node: node22Workspaces.includes(workspace.name) ? "22" : "24.22.3" });
  }
  // Separate matrices keep a full run below GitHub's 256-job limit per matrix.
  for (const group of Object.values(groups)) assert.ok(group.length <= 256, "Package matrix exceeds GitHub's 256-job limit");
  return { ...groups, bash, audit };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const before = event.before;
  const files = process.env.GITHUB_EVENT_NAME === "push" && before && before !== "0".repeat(40)
    ? execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", before, process.env.GITHUB_SHA, "--"], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).split("\0").filter(Boolean)
    : null;
  const plan = createWorkspaceBuildPlan(root);
  const node22 = JSON.parse(fs.readFileSync(path.join(root, "scripts/ci-unit-cache.json"), "utf8")).workspaces;
  const checks = packageChecks(plan, files, node22);
  for (const [name, value] of Object.entries(checks)) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${JSON.stringify(value)}\n`);
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `Package checks select directly changed workspaces; consumers are not expanded. Manual runs check all packages.\n\n`
    + [...checks.packages, ...checks.safe].map(item => `- ${item.workspace === "." ? "Root tests" : item.workspace}\n`).join("")
    + (checks.bash ? "- @poe-platform/safe-bash (four shards)\n" : "")
    + (checks.audit ? "- Dependency audit and lint stress tests\n" : ""));
}
