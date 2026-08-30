import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { sha256, writeNew } from "../harness/common.mjs";
import { expectedPrivateProfile } from "../harness/safejs-binding.mjs";

const privateRoot = "/Users/kjopek/Workspace/poe-code";
const excludedEngineDirectories = new Set([".git", "node_modules", "dist", ".cache", ".turbo"]);
const metadataPaths = ["AGENTS.md", ".gitignore", "package.json", "package-lock.json", "tsconfig.json", "packages/poe-agent/package.json"];
function record(filename) {
  assert.equal(realpathSync(filename), resolve(filename));
  const stat = lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), filename);
  const bytes = readFileSync(filename);
  return { bytes: bytes.length, sha256: sha256(bytes), mode: stat.mode & 0o777, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}
export function privateSnapshot() {
  assert.equal(realpathSync(privateRoot), privateRoot);
  const git = (...args) => execFileSync("/usr/bin/git", ["-C", privateRoot, "-c", "core.fsmonitor=false", ...args], { env: { PATH: "/usr/bin:/bin", LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" }, timeout: 20000, maxBuffer: 32 * 1024 * 1024 }).toString();
  const engineRoot = join(privateRoot, "packages/safejs");
  assert.equal(realpathSync(engineRoot), engineRoot);
  const engine = [];
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      if (excludedEngineDirectories.has(name)) continue;
      const filename = join(directory, name);
      const stat = lstatSync(filename);
      assert.ok(!stat.isSymbolicLink(), filename);
      if (stat.isDirectory()) visit(filename);
      else engine.push({ path: relative(engineRoot, filename), ...record(filename) });
    }
  }
  visit(engineRoot);
  engine.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return {
    head: git("rev-parse", "HEAD").trim(), tree: git("rev-parse", "HEAD^{tree}").trim(),
    status: git("status", "--porcelain=v1"), staged: git("diff", "--cached", "--name-status"),
    index: record(resolve(privateRoot, git("rev-parse", "--git-path", "index").trim())),
    metadata: Object.fromEntries(metadataPaths.map(path => [path, record(join(privateRoot, path))])), engine,
  };
}
export function verifyPrivatePrecondition(before) {
  assert.deepEqual(before, expectedPrivateProfile(), "Fresh private state must match the exact approved public status/metadata profile; unknown drift is not ignored");
}
export function copyActualEngine(before, destination) {
  verifyPrivatePrecondition(before);
  assert.equal(before.engine.length, 264);
  for (const entry of before.engine) {
    const source = join(privateRoot, "packages/safejs", entry.path);
    assert.deepEqual(record(source), { bytes: entry.bytes, sha256: entry.sha256, mode: entry.mode, mtimeMs: entry.mtimeMs, ctimeMs: entry.ctimeMs });
    writeNew(join(destination, entry.path), readFileSync(source), entry.mode);
  }
}
