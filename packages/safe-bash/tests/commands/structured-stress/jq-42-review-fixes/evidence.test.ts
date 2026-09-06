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
const unusedBindingMigration = {
  path: "tests/commands/structured/helpers.ts",
  before: { bytes: 2041, sha256: "58f64bcaaedc766a7b13a77195a93dd0886770ea20f6b9c57fbe032d642950b2" },
  after: { bytes: 2053, sha256: "867a73c52c69532d424141133b2d4201293f43deae19df7303b7be98e9871536" },
  substitutions: [
    { offset: 1350, before: "_stdoutBytes", after: "ignoredStdoutBytes" },
    { offset: 1383, before: "_stderrBytes", after: "ignoredStderrBytes" },
  ],
};
const resourceDepthMigration = {
  path: "tests/commands/structured/resources.test.ts",
  owner: "tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts",
  snapshot: "tests/commands/structured-stress/jq-grammar-canonical-plan/after-native/tests/commands/structured/resources.test.ts.txt",
  receipt: {
    path: "tests/commands/structured-stress/jq-42-review-fixes/resource-depth-receipt-644.json",
    bytes: 1735,
    sha256: "42afb49e94f3528829d9a26cf2aaf9d3d14eba4ad556ec1e27fbf0d1dbf6625c",
  },
  before: { bytes: 6029, sha256: "c61d9f482fc8c76a432d962a134c7834e4fb381a9a501e94b92dc27f79012061" },
  after: { bytes: 6495, sha256: "55e0aecebc8c3e2deb3b78d90fcb612a54103866b7d8b2488900b2dcf1ba4a91" },
};
type ResourceDepthInput = {
  path: string;
  expected: string;
  current: Buffer;
  snapshot: Buffer;
  index: number;
  receipt: { owner: string; path: string; bytes: Buffer };
};
type ResourceDepthReceipt = {
  version: number;
  owner: string;
  members: Array<{
    path: string;
    before: { bytes: number; sha256: string };
    after: { bytes: number; sha256: string };
    substitutions: Array<{ offset: number; before: string; after: string }>;
  }>;
};

function assertResourceDepthMigration(input: ResourceDepthInput) {
  assert.equal(input.path, resourceDepthMigration.path, "exact resource-depth migration path");
  assert.equal(input.expected, resourceDepthMigration.before.sha256, "original resource-depth sealed digest");
  assert.equal(input.index, 0, "exact resource-depth receipt member");
  assert.equal(input.receipt.owner, resourceDepthMigration.owner, "exact resource-depth receipt owner");
  assert.equal(input.receipt.path, resourceDepthMigration.receipt.path, "exact resource-depth receipt path");
  assert.equal(input.receipt.bytes.length, resourceDepthMigration.receipt.bytes, "reviewed resource-depth receipt size");
  assert.equal(digest(input.receipt.bytes), resourceDepthMigration.receipt.sha256, "reviewed resource-depth receipt digest");
  const receipt = JSON.parse(input.receipt.bytes.toString("utf8")) as ResourceDepthReceipt;
  assert.equal(receipt.version, 1, "resource-depth receipt version");
  assert.equal(receipt.owner, resourceDepthMigration.owner, "authenticated resource-depth receipt owner");
  assert.equal(receipt.members.length, 1, "one approved resource-depth member");
  const member = receipt.members[input.index]!;
  assert.equal(member.path, input.path, "authenticated resource-depth member path");
  assert.deepEqual(member.before, resourceDepthMigration.before, "authenticated resource-depth before binding");
  assert.deepEqual(member.after, resourceDepthMigration.after, "authenticated resource-depth after binding");
  assert.equal(input.current.length, member.after.bytes, "reviewed resource-depth source size");
  assert.equal(digest(input.current), member.after.sha256, "reviewed resource-depth source digest");
  assert.equal(input.snapshot.length, member.before.bytes, "original resource-depth snapshot size");
  assert.equal(digest(input.snapshot), input.expected, "original resource-depth snapshot digest");
  assert.equal(member.substitutions.length, 1, "one exact resource-depth block replacement");
  const substitution = member.substitutions[0]!;
  const replacement = Buffer.from(substitution.after);
  const end = substitution.offset + replacement.length;
  assert.ok(Number.isSafeInteger(substitution.offset) && substitution.offset >= 0 && end <= input.current.length, "bounded resource-depth replacement");
  assert.deepEqual(input.current.subarray(substitution.offset, end), replacement, "exact approved depth assertions and malformed control");
  const original = Buffer.concat([input.current.subarray(0, substitution.offset), Buffer.from(substitution.before), input.current.subarray(end)]);
  assert.equal(original.length, member.before.bytes, "reconstructed resource-depth source size");
  assert.equal(digest(original), input.expected, "only the exact approved resource-depth transformation");
  assert.deepEqual(original, input.snapshot, "unchanged historical resource-depth snapshot");
  return original;
}

function assertUnusedBindingMigration(path: string, expected: string, current: Buffer) {
  assert.equal(path, unusedBindingMigration.path, "exact unused-binding migration path");
  assert.equal(expected, unusedBindingMigration.before.sha256, "original unused-binding sealed digest");
  assert.equal(current.length, unusedBindingMigration.after.bytes, "reviewed unused-binding source size");
  assert.equal(digest(current), unusedBindingMigration.after.sha256, "reviewed unused-binding source digest");
  const chunks: Buffer[] = [];
  let previous = 0;
  for (const substitution of unusedBindingMigration.substitutions) {
    const after = Buffer.from(substitution.after);
    const end = substitution.offset + after.length;
    assert.ok(substitution.offset >= previous && end <= current.length, "ordered exact binding offsets");
    assert.deepEqual(current.subarray(substitution.offset, end), after, "exact reviewed binding spelling");
    chunks.push(current.subarray(previous, substitution.offset), Buffer.from(substitution.before));
    previous = end;
  }
  chunks.push(current.subarray(previous));
  const original = Buffer.concat(chunks);
  assert.equal(original.length, unusedBindingMigration.before.bytes, "original unused-binding source size");
  assert.equal(digest(original), expected, "only the two exact reviewed binding substitutions");
  return original;
}

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
  assert.ok(selected, "repair receipt member exists");
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

test("frozen historical evidence and retained non-native canonical seals remain intact", context => {
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
  const depthReceipt = readFileSync(new URL("./resource-depth-receipt-644.json", import.meta.url));
  const compared = new Set<string>(), migrated = new Set<string>();
  const bindingMigrated = new Set<string>();
  const depthMigrated = new Set<string>();
  function assertCurrent(path: string, expected: string, snapshot?: Buffer) {
    assert.ok(!compared.has(path), "duplicate current comparison");
    let current = readFileSync(path);
    if (path === resourceDepthMigration.path) {
      assert.ok(snapshot, "resource-depth member retains its authenticated historical snapshot");
      current = assertResourceDepthMigration({
        path, expected, current, snapshot, index: 0,
        receipt: { owner: resourceDepthMigration.owner, path: resourceDepthMigration.receipt.path, bytes: depthReceipt },
      });
      depthMigrated.add(path);
    }
    if (path === unusedBindingMigration.path) {
      current = assertUnusedBindingMigration(path, expected, current);
      if (snapshot) assert.deepEqual(current, snapshot, "unchanged historical helper snapshot");
      bindingMigrated.add(path);
    }
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
    } else if (path !== "tests/commands/structured/oracle.test.ts" && path !== "tests/commands/structured/semantics.test.ts") {
      assertCurrent(path, hash);
    }
  }
  assert.equal(compared.size, 140, "current comparisons after two native source-seal retirements");
  assert.deepEqual([...migrated].sort(), spellingMigrations.map(entry => entry.path).sort(), "only the four approved migrations");
  assert.equal(compared.size - migrated.size, 136, "retained current comparisons outside spelling migrations");
  assert.equal(snapshots.size, 23, "all original historical snapshots");
  assert.deepEqual([...bindingMigrated], [unusedBindingMigration.path], "only the reviewed unused-binding helper migration");
  assert.deepEqual([...depthMigrated], [resourceDepthMigration.path], "only the reviewed resource-depth fixture migration");
  const unchangedComparisons = compared.size - migrated.size - bindingMigrated.size - depthMigrated.size;
  assert.equal(unchangedComparisons, 134, "byte-unchanged retained current comparisons");
  context.diagnostic(JSON.stringify({ liveComparisons: compared.size, unchangedComparisons, spellingMigrations: migrated.size, historicalSnapshots: snapshots.size, unusedBindingMigrations: bindingMigrated.size, resourceDepthMigrations: depthMigrated.size, byteUnchangedComparisons: unchangedComparisons }));
});

type MigrationControl = { migration: SpellingMigration; expected: string; current: Buffer; receipt: Buffer };
const spellingControls: Array<[string, ((input: MigrationControl) => void) | null]> = [
  ["accepts the exact reviewed image", null],
  ["rejects a different receipt-member path", input => { input.migration.path = "tests/commands/tree/backends.test.ts"; }],
  ["rejects a wrong selector", input => { input.migration.index += 1; }],
  ["rejects altered deletion offsets", input => { input.migration.deletions = input.migration.deletions.map(offset => offset + 1); }],
  ["rejects receipt mutation", input => {
    input.receipt = Buffer.from(input.receipt);
    const firstByte = input.receipt[0];
    assert.ok(firstByte !== undefined, "receipt mutation requires a byte");
    input.receipt[0] = firstByte ^ 1;
  }],
  ["rejects additional same-size source edits", input => {
    input.current = Buffer.from(input.current);
    const firstByte = input.current[0];
    assert.ok(firstByte !== undefined, "source mutation requires a byte");
    input.current[0] = firstByte ^ 1;
  }],
  ["rejects extra source bytes", input => { input.current = Buffer.concat([input.current, Buffer.from("\n")]); }],
  ["rejects a changed historical expected digest", input => { input.expected = "0".repeat(64); }],
];

for (const migration of spellingMigrations) for (const [name, mutate] of spellingControls) test("reviewed spelling migration " + migration.path + " " + name, () => {
  const evidence = JSON.parse(readFileSync(new URL("./immutable-before.json", import.meta.url), "utf8")) as { files: Record<string, string> };
  const predecessor = JSON.parse(readFileSync(new URL("../jq-grammar-canonical-plan/patch-manifest-v3.json", import.meta.url), "utf8")) as { files: Array<{ path: string; afterSha256: string }> };
  const expected = predecessor.files.find(entry => entry.path === migration.path)?.afterSha256 ?? evidence.files[migration.path];
  assert.ok(typeof expected === "string", "historical expected digest exists");
  const input: MigrationControl = {
    migration: { ...migration, deletions: [...migration.deletions] },
    expected,
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
  const firstByte = snapshot[0];
  assert.ok(firstByte !== undefined, "historical snapshot mutation requires a byte");
  snapshot[0] = firstByte ^ 1;
  const restored = assertSpellingMigration(migration, original.afterSha256, readFileSync(migration.path), readFileSync(new URL("./" + repairReceipts[migration.receipt].filename, import.meta.url)));
  assert.throws(() => assert.deepEqual(restored, snapshot), { code: "ERR_ASSERTION" });
});

type UnusedBindingControl = { path: string; expected: string; current: Buffer };
const unusedBindingControls: Array<[string, ((input: UnusedBindingControl) => void) | null]> = [
  ["reconstructs the unchanged sealed snapshot", null],
  ["rejects renaming only stdout", input => { input.current = Buffer.from(input.current.toString("utf8").replace("ignoredStderrBytes", "_stderrBytes")); }],
  ["rejects renaming only stderr", input => { input.current = Buffer.from(input.current.toString("utf8").replace("ignoredStdoutBytes", "_stdoutBytes")); }],
  ["rejects changed destructuring property names", input => { input.current = Buffer.from(input.current.toString("utf8").replace("stdoutBytes: ignoredStdoutBytes", "stderrBytes: ignoredStdoutBytes")); }],
  ["rejects use of the ignored binding", input => { input.current = Buffer.from(input.current.toString("utf8").replace("return result;", "return ignoredStdoutBytes;")); }],
  ["rejects a different source path", input => { input.path = "tests/commands/structured/cli.test.ts"; }],
  ["rejects same-size body drift", input => {
    input.current = Buffer.from(input.current.toString("utf8").replace("return result;", "return source;"));
    assert.equal(input.current.length, unusedBindingMigration.after.bytes);
  }],
  ["rejects incorrect same-size binding substitution", input => {
    input.current = Buffer.from(input.current.toString("utf8").replace("ignoredStdoutBytes", "ignoredStderrBytes"));
    assert.equal(input.current.length, unusedBindingMigration.after.bytes);
  }],
  ["rejects extra source bytes", input => { input.current = Buffer.concat([input.current, Buffer.from("\n")]); }],
  ["rejects a wrong original digest", input => { input.expected = "0".repeat(64); }],
  ["rejects the unreviewed original spelling", input => {
    input.current = Buffer.from(input.current.toString("utf8").replace("ignoredStdoutBytes", "_stdoutBytes").replace("ignoredStderrBytes", "_stderrBytes"));
  }],
];

for (const [name, mutate] of unusedBindingControls) test("reviewed unused-binding migration " + name, () => {
  const predecessor = JSON.parse(readFileSync(new URL("../jq-grammar-canonical-plan/patch-manifest-v3.json", import.meta.url), "utf8")) as {
    files: Array<{ path: string; afterSha256: string; afterSnapshot: string }>;
  };
  const original = predecessor.files.find(entry => entry.path === unusedBindingMigration.path)!;
  const input: UnusedBindingControl = {
    path: unusedBindingMigration.path,
    expected: original.afterSha256,
    current: readFileSync(unusedBindingMigration.path),
  };
  if (mutate) {
    mutate(input);
    assert.throws(() => assertUnusedBindingMigration(input.path, input.expected, input.current), { code: "ERR_ASSERTION" });
  } else {
    const restored = assertUnusedBindingMigration(input.path, input.expected, input.current);
    const snapshot = readFileSync(original.afterSnapshot);
    assert.equal(digest(snapshot), unusedBindingMigration.before.sha256);
    assert.deepEqual(restored, snapshot, "unchanged historical helper snapshot");
    const firstByte = snapshot[0];
    assert.ok(firstByte !== undefined, "historical helper snapshot mutation requires a byte");
    snapshot[0] = firstByte ^ 1;
    assert.throws(() => assert.deepEqual(restored, snapshot), { code: "ERR_ASSERTION" });
  }
});

const resourceDepthControls: Array<[string, ((input: ResourceDepthInput) => void) | null]> = [
  ["reconstructs the exact authenticated historical snapshot", null],
  ["rejects a different member", input => { input.index = 1; }],
  ["rejects a different source path", input => { input.path = "tests/commands/structured/cli.test.ts"; }],
  ["rejects an aliased source path", input => { input.path = "./" + input.path; }],
  ["rejects a changed old digest", input => { input.expected = "0".repeat(64); }],
  ["rejects a different receipt owner", input => { input.receipt.owner = "tests/commands/structured/cli.test.ts"; }],
  ["rejects a different receipt path", input => { input.receipt.path = "tests/commands/structured-stress/jq-42-review-fixes/lint-repair-receipt-20260830.json"; }],
  ["rejects an aliased receipt path", input => { input.receipt.path = "./" + input.receipt.path; }],
  ["rejects receipt mutation before parsing", input => { input.receipt.bytes[0] = 0; }],
  ["rejects extra receipt bytes", input => { input.receipt.bytes = Buffer.concat([input.receipt.bytes, Buffer.from("\n")]); }],
  ["rejects truncated receipt bytes", input => { input.receipt.bytes = input.receipt.bytes.subarray(1); }],
  ["rejects a rewritten receipt member path", input => {
    const receipt = JSON.parse(input.receipt.bytes.toString("utf8")) as ResourceDepthReceipt;
    receipt.members[0]!.path = "tests/commands/structured/cli.test.ts";
    input.receipt.bytes = Buffer.from(JSON.stringify(receipt, null, 2) + "\n");
  }],
  ["rejects a rewritten receipt selector offset", input => {
    const receipt = JSON.parse(input.receipt.bytes.toString("utf8")) as ResourceDepthReceipt;
    receipt.members[0]!.substitutions[0]!.offset++;
    input.receipt.bytes = Buffer.from(JSON.stringify(receipt, null, 2) + "\n");
  }],
  ["rejects a receipt with extra approved members", input => {
    const receipt = JSON.parse(input.receipt.bytes.toString("utf8")) as ResourceDepthReceipt;
    receipt.members.push(receipt.members[0]!);
    input.receipt.bytes = Buffer.from(JSON.stringify(receipt, null, 2) + "\n");
  }],
  ["rejects same-size source mutation", input => { input.current[0] = input.current[0]! ^ 1; }],
  ["rejects extra source edits", input => { input.current = Buffer.concat([input.current, Buffer.from("\n")]); }],
  ["rejects weakening the new status assertion", input => {
    input.current = Buffer.from(input.current.toString("utf8").replace("    assert.equal(result.exitCode, 5);", "    assert.equal(result.exitCode, 0);"));
    assert.equal(input.current.length, resourceDepthMigration.after.bytes);
  }],
  ["rejects restoring the malformed deep source", input => {
    input.current = Buffer.from(input.current.toString("utf8").replace('".a".repeat(1000)', '"." + ".a".repeat(1000)'));
    assert.notEqual(input.current.length, resourceDepthMigration.after.bytes);
  }],
  ["rejects altered malformed-control diagnostics", input => {
    input.current = Buffer.from(input.current.toString("utf8").replace("unexpected IDENT", "unexpected OTHER"));
    assert.equal(input.current.length, resourceDepthMigration.after.bytes);
  }],
  ["rejects original snapshot mutation", input => { input.snapshot[0] = input.snapshot[0]! ^ 1; }],
  ["rejects extra original snapshot bytes", input => { input.snapshot = Buffer.concat([input.snapshot, Buffer.from("\n")]); }],
  ["rejects the unreviewed original source image", input => { input.current = Buffer.from(input.snapshot); }],
];

for (const [name, mutate] of resourceDepthControls) test("reviewed resource-depth migration " + name, context => {
  const input: ResourceDepthInput = {
    path: resourceDepthMigration.path,
    expected: resourceDepthMigration.before.sha256,
    current: readFileSync(resourceDepthMigration.path),
    snapshot: readFileSync(resourceDepthMigration.snapshot),
    index: 0,
    receipt: {
      owner: resourceDepthMigration.owner,
      path: resourceDepthMigration.receipt.path,
      bytes: readFileSync(new URL("./resource-depth-receipt-644.json", import.meta.url)),
    },
  };
  if (mutate) {
    mutate(input);
    const parse = context.mock.method(JSON, "parse");
    assert.throws(() => assertResourceDepthMigration(input), { code: "ERR_ASSERTION" });
    if (input.path !== resourceDepthMigration.path || input.expected !== resourceDepthMigration.before.sha256 || input.index !== 0
      || input.receipt.owner !== resourceDepthMigration.owner || input.receipt.path !== resourceDepthMigration.receipt.path
      || input.receipt.bytes.length !== resourceDepthMigration.receipt.bytes || digest(input.receipt.bytes) !== resourceDepthMigration.receipt.sha256) {
      assert.equal(parse.mock.callCount(), 0, "reject unauthenticated receipt or selector before JSON parsing");
    }
  } else {
    assert.deepEqual(assertResourceDepthMigration(input), input.snapshot);
  }
});
