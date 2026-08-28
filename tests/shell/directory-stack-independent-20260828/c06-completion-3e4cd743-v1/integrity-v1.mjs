import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export function census(root) {
  const entries = {};
  function visit(relative) {
    const absolute = resolve(root, relative), stat = lstatSync(absolute); assert(!stat.isSymbolicLink(), "no symlink: " + absolute);
    if (stat.isDirectory()) { entries[relative] = { kind: "directory", mode: stat.mode & 0o777 }; for (const name of readdirSync(absolute).sort()) visit(relative ? relative + "/" + name : name); }
    else { assert(stat.isFile()); entries[relative] = { kind: "file", mode: stat.mode & 0o777, bytes: stat.size, sha256: sha256(readFileSync(absolute)) }; }
  }
  visit(""); return entries;
}
export function checkFile(path, expected) { const stat = lstatSync(path); assert(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.mode & 0o777, expected.mode); assert.equal(stat.size, expected.bytes); assert.equal(sha256(readFileSync(path)), expected.sha256); }
