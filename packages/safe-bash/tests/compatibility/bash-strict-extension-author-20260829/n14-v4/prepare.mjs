import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const own = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(own, "../../../..");
export const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export const objectHash = (type, bytes) => createHash("sha1").update(`${type} ${bytes.length}\0`).update(bytes).digest("hex");
export async function hashExecutable(filename) {
  const before = fs.lstatSync(filename); assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= 128 * 1024 * 1024);
  const hash = createHash("sha256"); let length = 0;
  for await (const bytes of fs.createReadStream(filename, { highWaterMark: 65536 })) { length += bytes.length; assert.ok(length <= before.size); hash.update(bytes); }
  const after = fs.lstatSync(filename); assert.equal(after.size, before.size); assert.equal(after.ino, before.ino); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(length, before.size);
  return hash.digest("hex");
}
function admitted(name, maximum = 4 * 1024 * 1024) {
  assert.ok(!name.split("/").includes("AGENTS.md"));
  const stat = fs.lstatSync(path.join(repo, name)); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum);
  return fs.readFileSync(path.join(repo, name));
}

