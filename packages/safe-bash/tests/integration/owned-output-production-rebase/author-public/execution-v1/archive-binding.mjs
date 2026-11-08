import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, lstatSync, openSync, readFileSync, readSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { directory, environment, git, json, owner, regular, safeRelative, sha256 } from "../harness/common.mjs";

export const executionDirectory = join(directory, "execution-v1");
export function executionFreeze() {
  const path = `${owner}/execution-v1/EXECUTION-INPUTS.json`;
  const commit = git("log", "-1", "--format=%H", "--", path).toString().trim();
  assert.match(commit, /^[a-f0-9]{40}$/u);
  const bytes = git("show", `${commit}:${path}`);
  assert.deepEqual(regular(join(executionDirectory, "EXECUTION-INPUTS.json")), bytes);
  const freeze = JSON.parse(bytes);
  for (const entry of freeze.files) {
    const actual = regular(join(executionDirectory, safeRelative(entry.path)));
    assert.equal(sha256(actual), entry.sha256, entry.path);
    assert.deepEqual(actual, git("show", `${commit}:${owner}/execution-v1/${entry.path}`));
  }
  return { commit, manifestSha256: sha256(bytes), files: freeze.files };
}
export function committedEntries(commit) {
  const binding = json(join(executionDirectory, "CANDIDATE.json"));
  assert.equal(commit, binding.commit);
  const entries = git("ls-tree", "-rz", commit).toString().split("\0").filter(Boolean).map(line => {
    const separator = line.indexOf("\t");
    const header = line.slice(0, separator);
    const path = line.slice(separator + 1);
    const [mode, type, blob] = header.split(" ");
    assert.equal(type, "blob");
    assert.ok(["100644", "100755", "120000"].includes(mode));
    if (binding.nativeFixtureLiteralNames.some(entry => entry.path === path && entry.blob === blob)) {
      assert.ok(!path.startsWith("/") && path.split("/").every(part => part && part !== "." && part !== ".."));
    } else safeRelative(path);
    return { path, mode, blob };
  });
  assert.deepEqual(entries.filter(entry => entry.mode === "120000"), binding.nativeFixtureSymlinks.map(({ target, ...entry }) => entry));
  return entries;
}
export function snapshot(root, candidateRoot, symlinks) {
  assert.equal(realpathSync(root), resolve(root));
  const allowed = new Map(symlinks.map(entry => [join(candidateRoot, entry.path), entry]));
  const entries = [];
  function visit(current) {
    for (const name of readdirSync(current).sort()) {
      const filename = join(current, name);
      const stat = lstatSync(filename);
      if (stat.isSymbolicLink()) {
        const approved = allowed.get(filename);
        assert.ok(approved, `Unknown symlink refused: ${filename}`);
        const target = readlinkSync(filename);
        assert.equal(target, approved.target);
        entries.push({ path: relative(root, filename), kind: "native-fixture-symlink-data", target, sha256: sha256(target) });
      } else if (stat.isDirectory()) {
        entries.push({ path: relative(root, filename), kind: "directory", mode: stat.mode & 0o777 });
        visit(filename);
      } else {
        const bytes = regular(filename);
        entries.push({ path: relative(root, filename), kind: "file", mode: stat.mode & 0o777, bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  visit(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
}
export function verifyArchiveBytes(root, entries) {
  for (const entry of entries) {
    const filename = join(root, entry.path);
    const bytes = entry.mode === "120000" ? Buffer.from(readlinkSync(filename)) : regular(filename);
    const digest = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    assert.equal(digest, entry.blob, entry.path);
    if (entry.mode !== "120000") assert.equal(Boolean(lstatSync(filename).mode & 0o111), entry.mode === "100755", entry.path);
  }
}
export function hashFile(filename) {
  assert.equal(realpathSync(filename), resolve(filename));
  assert.ok(lstatSync(filename).isFile());
  const handle = openSync(filename, "r");
  const digest = createHash("sha256");
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let count;
    while ((count = readSync(handle, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, count));
    return digest.digest("hex");
  } finally { closeSync(handle); }
}
export function captureArchive(commit, filename) {
  const handle = openSync(filename, "wx", 0o644);
  try {
    const result = spawnSync("/usr/bin/git", ["-C", "/Users/kjopek/Workspace/safe-bash", "-c", "core.fsmonitor=false", "archive", "--format=tar", commit], { env: environment, timeout: 180000, stdio: ["ignore", handle, "pipe"] });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr?.toString());
  } finally { closeSync(handle); }
}
