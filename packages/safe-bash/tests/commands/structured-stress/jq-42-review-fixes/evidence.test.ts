import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type SpellingMigration = { path: string; receipt: "test" | "helper"; index: number; deletions: readonly number[] };
const spellingMigrations: readonly SpellingMigration[] = [
  { path: "tests/commands/structured/cli.test.ts", receipt: "test", index: 4, deletions: [2622, 2678] },
  { path: "tests/commands/structured-stress/split-increment/command.test.ts", receipt: "test", index: 3, deletions: [1745, 1750, 2112, 2117] },
  { path: "tests/commands/structured-stress/cases.ts", receipt: "test", index: 10, deletions: [2223] },
  { path: "tests/commands/structured-stress/jq-42-independent-review/legacy-proof.ts", receipt: "helper", index: 2, deletions: [4199, 4209] },
];
const repairReceipts = {
  test: { filename: "lint-repair-receipt-20260830.json", bytes: 33365, sha256: "64a2ec2546adf12115a718e2d9156fea80fc261126a5c29605ac08257af0d20f" },
  helper: { filename: "helper-spelling-receipt-20260830.json", bytes: 10533, sha256: "4ce64460b4a4d1707de38931124b2da85bc4f37f0a799e0181f1366a6589731c" },
};

function assertSpellingMigration(migration: SpellingMigration, expected: string, current: Buffer, receiptBytes: Buffer) {
  const approved = spellingMigrations.find(entry => entry.path === migration.path);
  assert.ok(approved, "unapproved spelling migration path");
  assert.deepEqual(migration, approved, "exact spelling migration selector and deletions");
  const binding = repairReceipts[migration.receipt];
  assert.equal(receiptBytes.length, binding.bytes, "original repair receipt size");
  assert.equal(digest(receiptBytes), binding.sha256, "original repair receipt digest");
  const receipt = JSON.parse(receiptBytes.toString("utf8")) as {
    changed: Array<{ path: string; before: { bytes: number; sha256: string }; after: { bytes: number; sha256: string } }>;
    files: Array<{ path: string; predecessorBytes: number; predecessorSha256: string; bytes: number; sha256: string }>;
  };
  const helper = migration.receipt === "helper" ? receipt.files[migration.index] : undefined;
  const selected = helper ? {
    path: helper.path,
    before: { bytes: helper.predecessorBytes, sha256: helper.predecessorSha256 },
    after: { bytes: helper.bytes, sha256: helper.sha256 },
  } : receipt.changed[migration.index];
  assert.equal(selected.path, migration.path, "repair receipt path association");
  assert.equal(selected.before.sha256, expected, "original sealed expected digest");
  assert.equal(current.length, selected.after.bytes, "reviewed current source size");
  assert.equal(digest(current), selected.after.sha256, "reviewed current source digest");
  const chunks: Buffer[] = [];
  let previous = 0;
  for (const [index, offset] of migration.deletions.entries()) {
    const position = offset - index;
    assert.ok(position >= previous && position <= current.length, "ordered exact deletion offset");
    chunks.push(current.subarray(previous, position), Buffer.from([92]));
    previous = position;
  }
  chunks.push(current.subarray(previous));
  const original = Buffer.concat(chunks);
  assert.equal(original.length, selected.before.bytes, "original source size");
  assert.equal(digest(original), expected, "only the exact reviewed backslash deletions");
  return original;
}

test("nearby native bytes remain frozen before the source fix", () => {
  const bytes = readFileSync(new URL("./native-frozen.json", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "dd7a8d16d32ed2083e2fef49de2f9b59471aeb6b0ebe6959b38e3a42d7b35743");
});

test("frozen historical evidence and exactly approved migrated canonical files retain sealed bytes", context => {
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
  const snapshots = new Map<string, Buffer>();
  for (const approved of migration.files) {
    if (approved.beforeSnapshot !== null) {
      const before = readFileSync(approved.beforeSnapshot);
      assert.equal(digest(before), approved.beforeSha256, approved.beforeSnapshot);
      snapshots.set(approved.beforeSnapshot, before);
    }
    const after = readFileSync(approved.afterSnapshot);
    assert.equal(digest(after), approved.afterSha256, approved.afterSnapshot);
    snapshots.set(approved.afterSnapshot, after);
  }
  const receipts = {
    test: readFileSync(new URL("./lint-repair-receipt-20260830.json", import.meta.url)),
    helper: readFileSync(new URL("./helper-spelling-receipt-20260830.json", import.meta.url)),
  };
  const compared = new Set<string>(), migrated = new Set<string>();
  function assertCurrent(path: string, expected: string, snapshot?: Buffer) {
    assert.ok(!compared.has(path), "duplicate current comparison");
    const current = readFileSync(path);
    const repair = spellingMigrations.find(entry => entry.path === path);
    if (repair) {
      const original = assertSpellingMigration(repair, expected, current, receipts[repair.receipt]);
      if (snapshot) assert.deepEqual(original, snapshot, "unchanged historical snapshot");
      migrated.add(path);
    } else {
      assert.equal(digest(current), expected, path);
    }
    compared.add(path);
  }
  for (const approved of migration.files) assertCurrent(approved.path, approved.afterSha256, snapshots.get(approved.afterSnapshot));
  for (const [path, hash] of Object.entries(evidence.files)) {
    const approved = migration.files.find(file => file.path === path);
    if (approved) {
      assert.equal(approved.beforeSha256, hash, path);
      assert.notEqual(approved.beforeSnapshot, null, path);
      assert.equal(digest(readFileSync(approved.beforeSnapshot!)), hash, path);
    } else {
      assertCurrent(path, hash);
    }
  }
  assert.equal(compared.size, 142, "complete finite current comparison set");
  assert.deepEqual([...migrated].sort(), spellingMigrations.map(entry => entry.path).sort(), "only the four approved migrations");
  assert.equal(compared.size - migrated.size, 138, "unchanged current comparisons");
  assert.equal(snapshots.size, 23, "all original historical snapshots");
  context.diagnostic(JSON.stringify({ liveComparisons: compared.size, unchangedComparisons: compared.size - migrated.size, spellingMigrations: migrated.size, historicalSnapshots: snapshots.size }));
});

type MigrationControl = { migration: SpellingMigration; expected: string; current: Buffer; receipt: Buffer };
const spellingControls: Array<[string, ((input: MigrationControl) => void) | null]> = [
  ["accepts the exact reviewed image", null],
  ["rejects a different receipt-member path", input => { input.migration.path = "tests/commands/tree/backends.test.ts"; }],
  ["rejects a wrong selector", input => { input.migration.index += 1; }],
  ["rejects altered deletion offsets", input => { input.migration.deletions = input.migration.deletions.map(offset => offset + 1); }],
  ["rejects receipt mutation", input => { input.receipt = Buffer.from(input.receipt); input.receipt[0] ^= 1; }],
  ["rejects additional same-size source edits", input => { input.current = Buffer.from(input.current); input.current[0] ^= 1; }],
  ["rejects extra source bytes", input => { input.current = Buffer.concat([input.current, Buffer.from("\n")]); }],
  ["rejects a changed historical expected digest", input => { input.expected = "0".repeat(64); }],
];

for (const migration of spellingMigrations) for (const [name, mutate] of spellingControls) test("reviewed spelling migration " + migration.path + " " + name, () => {
  const evidence = JSON.parse(readFileSync(new URL("./immutable-before.json", import.meta.url), "utf8")) as { files: Record<string, string> };
  const predecessor = JSON.parse(readFileSync(new URL("../jq-grammar-canonical-plan/patch-manifest-v3.json", import.meta.url), "utf8")) as { files: Array<{ path: string; afterSha256: string }> };
  const input: MigrationControl = {
    migration: { ...migration, deletions: [...migration.deletions] },
    expected: predecessor.files.find(entry => entry.path === migration.path)?.afterSha256 ?? evidence.files[migration.path],
    current: readFileSync(migration.path),
    receipt: readFileSync(new URL("./" + repairReceipts[migration.receipt].filename, import.meta.url)),
  };
  if (mutate) {
    mutate(input);
    assert.throws(() => assertSpellingMigration(input.migration, input.expected, input.current, input.receipt), { code: "ERR_ASSERTION" });
  } else {
    assert.doesNotThrow(() => assertSpellingMigration(input.migration, input.expected, input.current, input.receipt));
  }
});

for (const migration of spellingMigrations.slice(0, 2)) test("reviewed spelling migration " + migration.path + " rejects historical snapshot mutation", () => {
  const predecessor = JSON.parse(readFileSync(new URL("../jq-grammar-canonical-plan/patch-manifest-v3.json", import.meta.url), "utf8")) as { files: Array<{ path: string; afterSha256: string; afterSnapshot: string }> };
  const original = predecessor.files.find(entry => entry.path === migration.path)!;
  const snapshot = readFileSync(original.afterSnapshot);
  snapshot[0] ^= 1;
  const restored = assertSpellingMigration(migration, original.afterSha256, readFileSync(migration.path), readFileSync(new URL("./" + repairReceipts[migration.receipt].filename, import.meta.url)));
  assert.throws(() => assert.deepEqual(restored, snapshot), { code: "ERR_ASSERTION" });
});
