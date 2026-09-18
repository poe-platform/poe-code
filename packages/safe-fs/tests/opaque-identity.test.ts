import assert from "node:assert/strict";
import { test } from "vitest";
import { compareIdentity } from "../src/fs/mount/identity.js";
import type { FileStat } from "../src/contracts/filesystem.js";

test("opaque backing identity compares aliases independently of namespace versions", () => {
  const scope = {};
  const original: FileStat = { type: "file", size: 3, mode: 0o100644, mtimeMs: 0, atimeMs: 0, ctimeMs: 0,
    identityScope: scope, opaqueIdentity: "blob:a", opaqueVersion: "row:1" };
  assert.equal(compareIdentity(original, { ...original, opaqueVersion: "row:2" }), "same");
  assert.equal(compareIdentity(original, { ...original, opaqueIdentity: "blob:b" }), "distinct");
  assert.equal(compareIdentity(original, { ...original, identityScope: {} }), "distinct");
  const { identityScope: ignoredScope, ...unscoped } = original;
  assert.equal(compareIdentity(original, unscoped), "unknown");
  assert.equal(compareIdentity(original, { ...original, opaqueIdentity: "" }), "unknown");
  const native = { ...original, dev: 0, ino: 1 };
  assert.equal(compareIdentity(native, { ...native, opaqueIdentity: "conflicting" }), "same");
});
