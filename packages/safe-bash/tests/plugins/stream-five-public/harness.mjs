import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./current-profile.mjs";

export const owned = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(owned, "../../..");
export const environment = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, LC_ALL: "C", LANG: "C", TZ: "UTC" };
export const selectedPaths = ["src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "scripts/verify-qualified-release.mjs", "tests/plugins/agent-commands.test.ts", "tests/plugins/stream-five-public", "tests/commands/metadata", "tests/commands/metadata-stress", "tests/commands/table-text", "tests/commands/table-text-stress", "tests/commands/stream-next-stress"];

export function run(command, args, cwd, extra = {}) {
  const result = spawnSync(command, args, { cwd, env: environment, encoding: "utf8", timeout: 180_000, maxBuffer: 32 * 1024 * 1024, ...extra });
  const record = { command: [command, ...args], cwd, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr };
  return record;
}

export function requireSuccess(record) {
  assert.equal(record.error, undefined, JSON.stringify(record));
  assert.equal(record.signal, null, JSON.stringify(record));
  assert.equal(record.status, 0, JSON.stringify(record));
  return record;
}

export function json(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
}

export function manifest(root, relative = "src") {
  const entries = [];
  const walk = path => {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true }).sort((left, right) => left.name < right.name ? -1 : 1)) {
      if (entry.name === ".runs") continue;
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else entries.push({ path: child, sha256: sha256(readFileSync(join(root, child))) });
    }
  };
  walk(relative);
  return entries;
}

export function snapshot(sourceRef = "HEAD") {
  const sourceCommit = requireSuccess(run("git", ["--no-replace-objects", "rev-parse", "--verify", `${sourceRef}^{commit}`], repository)).stdout.trim();
  mkdirSync(join(owned, ".runs"), { recursive: true });
  const directory = mkdtempSync(join(owned, ".runs/qualified-"));
  const root = join(directory, "snapshot");
  mkdirSync(root);
  requireSuccess(run("git", ["--no-replace-objects", "archive", "--format=tar", `--output=${join(directory, "source.tar")}`, sourceCommit, ...selectedPaths], repository));
  requireSuccess(run("/usr/bin/tar", ["-xf", join(directory, "source.tar"), "-C", root], repository));
  const harness = ["scripts/verify-qualified-release.mjs", ...manifest(repository, "tests/plugins/stream-five-public").filter(entry => !entry.path.includes("/evidence/") && /\.(?:mjs|fixture)$/u.test(entry.path)).map(entry => entry.path)];
  for (const path of harness) assert.equal(sha256(readFileSync(join(root, path))), sha256(readFileSync(join(repository, path))), `runner differs from chosen source: ${path}`);
  symlinkSync(join(repository, "node_modules"), join(root, "node_modules"), "dir");
  const sources = [...manifest(root), ...["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"].map(path => ({ path, sha256: sha256(readFileSync(join(root, path))) }))];
  const report = { sourceCommit, directory, root, startedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, environment, sources, sourceTreeSha256: sha256(JSON.stringify(sources)), archiveSha256: sha256(readFileSync(join(directory, "source.tar"))), harness: harness.map(path => ({ path, sha256: sha256(readFileSync(join(root, path))) })), tooling: [process.execPath, "node_modules/typescript/lib/_tsc.js", "node_modules/typescript/package.json", "node_modules/tsx/package.json", "node_modules/@types/node/package.json"].map(path => ({ path, sha256: sha256(readFileSync(resolve(repository, path))) })), indexBefore: requireSuccess(run("git", ["diff", "--cached", "--name-only"], repository)).stdout, steps: [] };
  json(join(directory, "snapshot.json"), report);
  console.log(JSON.stringify({ directory, sourceCommit, sourceTreeSha256: report.sourceTreeSha256 }));
  return report;
}

export function step(report, name, command, args, cwd = report.root, extra = {}) {
  const record = run(command, args, cwd, extra);
  report.steps.push({ name, ...record });
  json(join(report.directory, `${name}.json`), record);
  requireSuccess(record);
  return record;
}

export function finish(report, exitCode, error) {
  report.exitCode = exitCode;
  report.error = error?.stack;
  report.finishedAt = new Date().toISOString();
  report.sourceUnchanged = report.sources.every(entry => sha256(readFileSync(join(report.root, entry.path))) === entry.sha256);
  report.indexAfter = requireSuccess(run("git", ["diff", "--cached", "--name-only"], repository)).stdout;
  if (!report.sourceUnchanged) report.exitCode = 1;
  json(join(report.directory, "result.json"), report);
  console.log(JSON.stringify({ directory: report.directory, sourceCommit: report.sourceCommit, exitCode: report.exitCode, sourceUnchanged: report.sourceUnchanged, error: error?.message }));
  process.exitCode = report.exitCode;
}
