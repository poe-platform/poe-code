import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const objectHash = (type, bytes) => createHash("sha1").update(`${type} ${bytes.length}\0`).update(bytes).digest("hex");
export const unpack = path => JSON.parse(gunzipSync(Buffer.from(readFileSync(path, "utf8"), "base64")));
export function decodeEvidence(archive) {
  const decoded = new Map(), memo = new Map();
  function restore(index) {
    if (memo.has(index)) return memo.get(index);
    const node = archive.nodes[index];
    const value = node && typeof node === "object" ? node.array ? node.array.map(restore) : Object.fromEntries(node.object.map(([key, child]) => [key, restore(child)])) : node;
    memo.set(index, value); return value;
  }
  for (const entry of archive.files) {
    const value = restore(entry.index);
    const text = entry.format === "json" ? JSON.stringify(value) : entry.format === "json2-newline" ? JSON.stringify(value, null, 2) + "\n" : entry.format === "jsonl" ? value.map(line => JSON.stringify(line)).join("\n") + (value.length ? "\n" : "") : value;
    assert.equal(sha256(text), entry.sha256); assert(!decoded.has(entry.path)); decoded.set(entry.path, text);
  }
  return decoded;
}
export function census(root) {
  const entries = {};
  function visit(relative) {
    const absolute = resolve(root, relative), stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) entries[relative] = { kind: "symlink", mode: stat.mode & 0o777, target: readlinkSync(absolute) };
    else if (stat.isDirectory()) { entries[relative] = { kind: "directory", mode: stat.mode & 0o777 }; for (const name of readdirSync(absolute).sort()) visit(relative ? relative + "/" + name : name); }
    else { assert(stat.isFile()); entries[relative] = { kind: "file", mode: stat.mode & 0o777, bytes: stat.size, sha256: sha256(readFileSync(absolute)) }; }
  }
  visit(""); return entries;
}
