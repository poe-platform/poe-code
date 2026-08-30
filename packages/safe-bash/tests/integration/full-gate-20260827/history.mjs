import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, createReadStream, existsSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export async function isolatedHistory(origin, destination, revision, pack, env) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  assert.equal(existsSync(join(destination, ".git")), false);
  const output = openSync(pack, "wx");
  let packed;
  try {
    packed = spawnSync("git", ["pack-objects", "--stdout", "--revs"], { cwd: origin, env, input: revision + "\n", stdio: ["pipe", output, "pipe"], timeout: 180000 });
  } finally { closeSync(output); }
  assert.ifError(packed.error); assert.equal(packed.status, 0, packed.stderr?.toString());
  const run = (...args) => execFileSync("git", args, { cwd: destination, env, encoding: "utf8", timeout: 180000, maxBuffer: 32 * 1024 * 1024 }).trim();
  run("init", "--quiet", "--template=");
  const input = openSync(pack, "r");
  let imported;
  try {
    imported = spawnSync("git", ["index-pack", "--stdin"], { cwd: destination, env, stdio: [input, "pipe", "pipe"], timeout: 180000 });
  } finally { closeSync(input); }
  assert.ifError(imported.error); assert.equal(imported.status, 0, imported.stderr?.toString());
  writeFileSync(join(destination, ".git/HEAD"), revision + "\n");
  run("read-tree", revision);
  assert.equal(run("rev-parse", "HEAD"), revision);
  assert.equal(run("for-each-ref"), "");
  assert.equal(existsSync(join(destination, ".git/objects/info/alternates")), false);
  const digest = createHash("sha256"); for await (const bytes of createReadStream(pack)) digest.update(bytes);
  return { revision, packSha256: digest.digest("hex"), objectCount: run("count-objects", "-v"), refs: [],
    policy: "Detached local metadata contains only objects reachable from the handed-off commit, no alternates, shared worktree, remotes, live index, or later refs. Working files remain the independently verified regular-file archive." };
}
