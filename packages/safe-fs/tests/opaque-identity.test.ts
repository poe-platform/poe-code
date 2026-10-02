import assert from "node:assert/strict";
import { test } from "vitest";
import { compareIdentity, compareFileVersion } from "../src/contracts/index.js";
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

test("file versions detect opaque generations independently of numeric metadata", () => {
  const original: FileStat = { type: "file", size: 3, mode: 0o100644, mtimeMs: 0, atimeMs: 0, ctimeMs: 0,
    opaqueVersion: "generation:1", revision: 1 };
  assert.equal(compareFileVersion(original, { ...original }), true);
  for (const changed of [{ opaqueVersion: "generation:2" }, { revision: 2 }, { size: 4 }, { mtimeMs: 1 }, { ctimeMs: 1 }]) {
    assert.equal(compareFileVersion(original, { ...original, ...changed }), false);
  }
  const { opaqueVersion: ignoredVersion, ...missing } = original;
  assert.equal(compareFileVersion(original, missing), false);
  assert.equal(compareFileVersion(missing, original), false);
  assert.equal(compareFileVersion(missing, { ...missing, atimeMs: 1 }), true);
});
