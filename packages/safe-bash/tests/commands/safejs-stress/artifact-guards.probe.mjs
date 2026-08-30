import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkBaseline, checkPatch, checkTarget } from "../../../docs/upstream-patches/safejs/verify.mjs";

const artifact = new URL("../../../docs/upstream-patches/safejs/lifecycle.patch", import.meta.url);
const patch = readFileSync(artifact, "utf8");
const hash = text => createHash("sha256").update(text).digest("hex");

test("artifact accepts only exact hash and approved seven update paths", () => {
  assert.equal(checkPatch(patch).length, 7);
  assert.throws(() => checkPatch(`${patch}\n`), /hash mismatch/);
  for (const path of ["/tmp/outside.ts", "packages/safejs/src/../../outside.ts", "packages/safejs/src/unapproved.ts"]) {
    const malicious = patch.replace("packages/safejs/src/run.ts", path);
    assert.throws(() => checkPatch(malicious, hash(malicious)));
  }
});

test("baseline mismatch and symlink patch ancestor fail closed", () => {
  const temporary = mkdtempSync(join(tmpdir(), "safejs-artifact-guards-"));
  try {
    assert.throws(() => checkBaseline(temporary), /baseline mismatch/);
    mkdirSync(join(temporary, "packages"));
    symlinkSync(tmpdir(), join(temporary, "packages/safejs"));
    assert.throws(() => checkTarget(temporary, "packages/safejs/src/run.ts"), /Symlink patch target\/ancestor rejected/);
    assert.throws(() => checkTarget(temporary, "../outside.ts"), /Unapproved patch path/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
