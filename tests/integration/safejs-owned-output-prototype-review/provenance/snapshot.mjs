import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = "/Users/kjopek/Workspace/safe-bash";
const privateRoot = "/Users/kjopek/Workspace/poe-code";
const owned = dirname(fileURLToPath(import.meta.url));
const phase = process.argv[2];
assert.ok(["before", "after"].includes(phase));
assert.equal(process.cwd(), repository);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const environment = { PATH: "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" };
const git = (root, ...args) => execFileSync("/usr/bin/git", ["-C", root, ...args], {
  env: environment, encoding: "utf8", timeout: 20000, maxBuffer: 32 * 1024 * 1024,
});
const excluded = new Set([".git", "node_modules", "dist", ".cache", ".turbo"]);

function record(path) {
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), path);
  return { bytes: stat.size, sha256: hash(readFileSync(path)), mode: stat.mode & 0o777, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}

function inventory(root) {
  assert.equal(realpathSync(root), root);
  const files = {};
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      if (excluded.has(name)) continue;
      const path = join(directory, name);
      const stat = lstatSync(path);
      assert.equal(stat.isSymbolicLink(), false, path);
      if (stat.isDirectory()) visit(path);
      else files[relative(root, path)] = record(path);
    }
  }
  visit(root);
  return files;
}

function state(root) {
  const index = resolve(root, git(root, "rev-parse", "--git-path", "index").trim());
  return {
    head: git(root, "rev-parse", "HEAD").trim(),
    tree: git(root, "rev-parse", "HEAD^{tree}").trim(),
    status: git(root, "status", "--porcelain=v1"),
    staged: git(root, "diff", "--cached", "--name-status"),
    index: record(index),
  };
}

const privateState = state(privateRoot);
privateState.metadata = Object.fromEntries([
  "AGENTS.md", ".gitignore", "package.json", "package-lock.json", "tsconfig.json", "packages/poe-agent/package.json",
].map(name => [name, record(join(privateRoot, name))]));
privateState.engine = inventory(join(privateRoot, "packages/safejs"));
const result = {
  at: new Date().toISOString(), phase,
  node: { path: process.execPath, version: process.version, platform: process.platform, arch: process.arch, ...record(process.execPath) },
  private: privateState, public: state(repository),
  publicSource: inventory(join(repository, "src")),
  publicRootInputs: Object.fromEntries(["AGENTS.md", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"].map(name => [name, record(join(repository, name))])),
  restrictions: { privateWrites: false, privateExecution: false, privateBuild: false, dependencyInstall: false, sourceBytesVendored: false },
};
if (phase === "after") {
  const before = JSON.parse(readFileSync(join(owned, "snapshot-before.json")));
  result.comparison = {
    privateUnchanged: JSON.stringify(result.private) === JSON.stringify(before.private),
    publicSourceUnchanged: JSON.stringify(result.publicSource) === JSON.stringify(before.publicSource),
    publicRootInputsUnchanged: JSON.stringify(result.publicRootInputs) === JSON.stringify(before.publicRootInputs),
    foreignStagingUnchanged: result.public.staged === before.public.staged,
  };
  writeFileSync(join(owned, "snapshot-after.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  assert.ok(result.comparison.privateUnchanged, "Private state changed; report drift, never restore it");
} else {
  writeFileSync(join(owned, "snapshot-before.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
}
console.log(JSON.stringify({ phase, privateHead: privateState.head, engineFiles: Object.keys(privateState.engine).length, privateIndex: privateState.index.sha256, comparison: result.comparison }));
