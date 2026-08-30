import assert from "node:assert/strict";
import { closeSync, constants, fstatSync, fsyncSync, mkdirSync, openSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export { read, json, digest, objectHash, inventory } from "../component-execution-v5/common.mjs";
import { read, inventory } from "../component-execution-v5/common.mjs";

export const directory = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(directory, "../../../..");
export const owner = "tests/integration/expr-public-independent-20260827";
export const prefix = `${owner}/r21-n04-reconciliation-v1`;
export const candidate = "44f00bf84278e3361b52106478d59c707ab7b2bc";
export const oldDirectory = join(repository, owner, "component-execution-v5");
export const legacyDirectory = join(repository, owner, "component-execution-v1");
export function flush(path) {
  const descriptor = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW);
  try { assert.ok(fstatSync(descriptor).isFile()); fsyncSync(descriptor); } finally { closeSync(descriptor); }
}
export function put(path, bytes, mode = 0o644) {
  assert.ok(path.startsWith(`${directory}/`));
  mkdirSync(dirname(path), { recursive: true, mode: 0o755 });
  writeFileSync(path, bytes, { flag: "wx", mode }); chmodSync(path, mode); flush(path);
}
export const putJson = (path, value) => put(path, JSON.stringify(value, null, 2) + "\n");
export function copyInventory(source, target, rows = inventory(source)) {
  mkdirSync(target, { recursive: true, mode: 0o755 });
  for (const row of rows) {
    if (row.kind === "directory") { mkdirSync(join(target, row.path), { recursive: true, mode: row.mode }); chmodSync(join(target, row.path), row.mode); }
    else { assert.equal(row.kind, "file"); put(join(target, row.path), read(join(source, row.path)), row.mode); }
  }
  assert.deepEqual(inventory(target), rows);
}
