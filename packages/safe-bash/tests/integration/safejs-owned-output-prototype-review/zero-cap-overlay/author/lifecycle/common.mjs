import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const repository = "/Users/kjopek/Workspace/safe-bash";
export const privateRoot = "/Users/kjopek/Workspace/poe-code";
export const owner = "tests/integration/safejs-owned-output-prototype-review/lifecycle";
export const original = "c8df5cf2819d7ad9d54c2a70800258c7c200665a";
export const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export const load = filename => JSON.parse(readFileSync(filename, "utf8"));
export const git = (root, ...args) => execFileSync("/usr/bin/git", ["-C", root, ...args], {
  env: { PATH: "/usr/bin:/bin", LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" }, timeout: 20000, maxBuffer: 32 * 1024 * 1024,
});
export function record(filename, metadata = false) {
  const stat = lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), filename);
  assert.equal(realpathSync(filename), resolve(filename));
  return { bytes: stat.size, sha256: sha(readFileSync(filename)), ...(metadata ? { mode: stat.mode & 0o777, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs } : {}) };
}
export function inventory(root, ignored = new Set(), metadata = false) {
  assert.equal(realpathSync(root), root);
  const files = [];
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      if (ignored.has(name)) continue;
      const filename = join(directory, name);
      const stat = lstatSync(filename);
      assert.equal(stat.isSymbolicLink(), false, filename);
      if (stat.isDirectory()) visit(filename);
      else files.push({ path: relative(root, filename), ...record(filename, metadata) });
    }
  }
  visit(root);
  return files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}
export function copyRegular(source, destination, expected) {
  const files = inventory(source);
  if (expected) assert.deepEqual(files, expected, source);
  for (const entry of files) {
    const target = join(destination, entry.path);
    mkdirSync(dirname(target), { recursive: true });
    const bytes = readFileSync(join(source, entry.path));
    assert.equal(sha(bytes), entry.sha256);
    writeFileSync(target, bytes, { flag: "wx", mode: 0o400 });
    chmodSync(target, 0o400);
  }
  assert.deepEqual(inventory(destination), files);
  return files;
}
export function state(root) {
  const text = (...args) => git(root, ...args).toString();
  return { head: text("rev-parse", "HEAD").trim(), tree: text("rev-parse", "HEAD^{tree}").trim(),
    status: text("status", "--porcelain=v1"), staged: text("diff", "--cached", "--name-status"),
    index: record(resolve(root, text("rev-parse", "--git-path", "index").trim()), true) };
}
export function privateState() {
  return { ...state(privateRoot), metadata: Object.fromEntries([
    "AGENTS.md", ".gitignore", "package.json", "package-lock.json", "tsconfig.json", "packages/poe-agent/package.json",
  ].map(filename => [filename, record(join(privateRoot, filename), true)])),
  engine: inventory(join(privateRoot, "packages/safejs"), new Set([".git", "node_modules", "dist", ".cache", ".turbo"]), true) };
}
export function verifyOriginal() {
  const entries = git(repository, "ls-tree", "-r", original, "--", owner).toString().trim().split("\n");
  assert.equal(entries.length, 14);
  for (const entry of entries) {
    const [header, filename] = entry.split("\t");
    const [mode, kind, oid] = header.split(" ");
    assert.equal(kind, "blob");
    const bytes = readFileSync(join(repository, filename));
    assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), oid, filename);
    assert.equal(Boolean(lstatSync(join(repository, filename)).mode & 0o111), mode === "100755");
  }
  return { commit: original, immutableFiles: entries.length, appendScope: "Original c8df subtree is authenticated by its exact 14 Git entries; execution-v1 is a separately authorized addition" };
}
export function serialize(error) {
  if (error === undefined) return { type: "undefined" };
  if (error === null || typeof error !== "object") return { type: typeof error, value: error };
  return { type: "object", name: error.name, message: error.message, code: error.code, budget: error.budget,
    current: error.current, limit: error.limit, stack: error.stack, ...(error instanceof AggregateError ? { errors: error.errors.map(serialize) } : {}) };
}
