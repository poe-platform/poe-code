import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("nearby native bytes remain frozen before the source fix", () => {
  const bytes = readFileSync(new URL("./native-frozen.json", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "dd7a8d16d32ed2083e2fef49de2f9b59471aeb6b0ebe6959b38e3a42d7b35743");
});

test("frozen historical evidence and exactly approved migrated canonical files retain sealed bytes", () => {
  const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const evidenceBytes = readFileSync(new URL("./immutable-before.json", import.meta.url));
  assert.equal(digest(evidenceBytes), "3766803b4bd8cc39f014e13de881cda034515b1094436530cdfa6505750ce9e3", "original immutable manifest");
  const evidence = JSON.parse(evidenceBytes.toString("utf8")) as { files: Record<string, string> };
  const migrationBytes = readFileSync(new URL("../jq-grammar-canonical-plan/patch-manifest-v3.json", import.meta.url));
  assert.equal(digest(migrationBytes), "aae89dfeefab84c50ef91a84c1c1608d659c0037ac96eb93c5f828ab32c938ce", "eab1d48a90456c1c2cdeb9289b32f1ed62429137 manifest approved by 95966ca2006bfa9bb35353cbac0a14038089c4ba");
  const migration = JSON.parse(migrationBytes.toString("utf8")) as { files: Array<{
    path: string;
    beforeSha256: string | null;
    afterSha256: string;
    beforeSnapshot: string | null;
    afterSnapshot: string;
  }> };
  assert.equal(digest(readFileSync(new URL("../jq-grammar-seal-proposal/before-2026-08-27/evidence.test.ts.txt", import.meta.url))), "bc2b19133b926eccf2519885bb5ca7a16f9ce09e1fb1a9cda78b6c365a7710f8", "dated original seal test");
  for (const approved of migration.files) {
    if (approved.beforeSnapshot !== null) {
      assert.equal(digest(readFileSync(approved.beforeSnapshot)), approved.beforeSha256, approved.beforeSnapshot);
    }
    assert.equal(digest(readFileSync(approved.afterSnapshot)), approved.afterSha256, approved.afterSnapshot);
    assert.equal(digest(readFileSync(approved.path)), approved.afterSha256, approved.path);
  }
  for (const [path, hash] of Object.entries(evidence.files)) {
    const approved = migration.files.find(file => file.path === path);
    if (approved) {
      assert.equal(approved.beforeSha256, hash, path);
      assert.notEqual(approved.beforeSnapshot, null, path);
      assert.equal(digest(readFileSync(approved.beforeSnapshot!)), hash, path);
    } else {
      assert.equal(digest(readFileSync(path)), hash, path);
    }
  }
});
