import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyMapfileFixtureRevision } from "./fixture-revision.js";

const referenceSHA256 = "8b36b77a1a9e1d922dc7c69976c33da779a275251341bc5c8a96a532f48b3e6f";
const fixture = { file: "review.test.ts", sha256: "c7945003e742e9062875ae64e8c3dfba73616bae71e0f7323419f30c4eb9e0e3" };
const current = readFileSync(new URL("./review.test.ts", import.meta.url));
const receipt = readFileSync(new URL("./fixture-revision.json", import.meta.url));
const observerInsertion = '      observe() { throw new Error("Mapfile must not acquire a descriptor observer"); },\n';
const referenceInsertion = '      async prepareReference() { throw new Error("unexpected reference binding"); },\n';
const observerOffset = 6884 + Buffer.byteLength(referenceInsertion);
const referenceOffset = 6677;
const expectedRevision = {
  fixture: fixture.file,
  originalSHA256: fixture.sha256,
  currentSHA256: "b47a4a59aedacda091505ea02db99853f2b8a76ca467e8013ad392d52de8d8ee",
  insertions: [
    {
      beforeSHA256: fixture.sha256,
      afterSHA256: "429f5d09ff457cc535a5afdc471abc31069d1bf2ab2e8b00fd161b2918c440a3",
      offset: 6884,
      insertion: observerInsertion,
    },
    {
      beforeSHA256: "429f5d09ff457cc535a5afdc471abc31069d1bf2ab2e8b00fd161b2918c440a3",
      afterSHA256: "b47a4a59aedacda091505ea02db99853f2b8a76ca467e8013ad392d52de8d8ee",
      offset: referenceOffset,
      insertion: referenceInsertion,
    },
  ],
};
const syntaxFixture = { file: "syntax.test.ts", sha256: "0d4163923fced16800c991e8ba5d3079cd9262019801139f8e94aef32d5e5911" };
const syntaxCurrent = readFileSync(new URL("./syntax.test.ts", import.meta.url));
const syntaxRevision = {
  fixture: syntaxFixture.file,
  originalSHA256: syntaxFixture.sha256,
  currentSHA256: "4513f0afea52aa8fbe5b593bf7fc6af1a70dcdb8190cdab09b2c4a6fe7fd1205",
  insertions: [
    {
      beforeSHA256: syntaxFixture.sha256,
      afterSHA256: "d7f11a817af67861b18ce2368ef7f8c5f83c58c721180957d2c1a5cfd58940eb",
      offset: 684,
      insertion: "?.arrayKeys",
    },
    {
      beforeSHA256: "d7f11a817af67861b18ce2368ef7f8c5f83c58c721180957d2c1a5cfd58940eb",
      afterSHA256: "4513f0afea52aa8fbe5b593bf7fc6af1a70dcdb8190cdab09b2c4a6fe7fd1205",
      offset: 721,
      insertion: "?.arrayKeys",
    },
  ],
};
const expectedReceipt = { schemaVersion: 3, referenceSHA256, fixtures: [expectedRevision, syntaxRevision] };

test("the exact observer mock insertion reconstructs the sealed native fixture", () => {
  verifyMapfileFixtureRevision(fixture, current, referenceSHA256, receipt);
});

test("altered observer insertion is not an authorized fixture revision", () => {
  const altered = Buffer.from(current);
  altered[observerOffset + 6] = 120;
  assert.throws(() => verifyMapfileFixtureRevision(fixture, altered, referenceSHA256, receipt));
});

for (const offset of [0, current.length - 2]) test(`fixture bytes outside the insertion remain sealed: ${offset}`, () => {
  const altered = Buffer.from(current);
  altered[offset] = altered[offset]! ^ 1;
  assert.throws(() => verifyMapfileFixtureRevision(fixture, altered, referenceSHA256, receipt));
});

test("moving the insertion does not authorize the same method elsewhere", () => {
  const end = observerOffset + Buffer.byteLength(observerInsertion);
  const altered = Buffer.concat([current.subarray(0, observerOffset - 1), current.subarray(observerOffset, end), current.subarray(observerOffset - 1, observerOffset), current.subarray(end)]);
  assert.throws(() => verifyMapfileFixtureRevision(fixture, altered, referenceSHA256, receipt));
});

test("wrong insertion offsets in a receipt fail authentication", () => {
  const altered = Buffer.from(receipt.toString().replace('"offset": 6884', '"offset": 6883'));
  assert.throws(() => verifyMapfileFixtureRevision(fixture, current, referenceSHA256, altered));
});

test("the revision cannot authorize another sealed fixture", () => {
  assert.throws(() => verifyMapfileFixtureRevision({ ...fixture, file: "native.test.ts" }, current, referenceSHA256, receipt));
});

test("the original native fixture and reference bindings cannot change", () => {
  assert.throws(() => verifyMapfileFixtureRevision({ ...fixture, sha256: "0".repeat(64) }, current, referenceSHA256, receipt));
  assert.throws(() => verifyMapfileFixtureRevision(fixture, current, "0".repeat(64), receipt));
});

test("receipt tampering is rejected before parsing", () => {
  assert.throws(() => verifyMapfileFixtureRevision(fixture, current, referenceSHA256, Buffer.from("{")));
  assert.throws(() => verifyMapfileFixtureRevision(fixture, current, referenceSHA256, Buffer.concat([receipt, Buffer.from(" ")])));
});

test("the receipt and candidate fixture retain their admission size limits", () => {
  assert.throws(() => verifyMapfileFixtureRevision(fixture, current, referenceSHA256, Buffer.alloc(4097)));
  assert.throws(() => verifyMapfileFixtureRevision(fixture, Buffer.alloc(65537), referenceSHA256, receipt));
});

test("version three retains the exact review insertion chain alongside the syntax revision", () => {
  assert.deepEqual(JSON.parse(receipt.toString()), expectedReceipt);
  verifyMapfileFixtureRevision(fixture, current, referenceSHA256, receipt);
});

test("each inverse step reconstructs its sealed predecessor and finally the native fixture", () => {
  let reconstructed = Buffer.from(current);
  for (const step of [...expectedRevision.insertions].reverse()) {
    assert.equal(createHash("sha256").update(reconstructed).digest("hex"), step.afterSHA256);
    const insertion = Buffer.from(step.insertion);
    assert.deepEqual(reconstructed.subarray(step.offset, step.offset + insertion.length), insertion);
    reconstructed = Buffer.concat([reconstructed.subarray(0, step.offset), reconstructed.subarray(step.offset + insertion.length)]);
    assert.equal(createHash("sha256").update(reconstructed).digest("hex"), step.beforeSHA256);
  }
  assert.equal(createHash("sha256").update(reconstructed).digest("hex"), fixture.sha256);
  verifyMapfileFixtureRevision(fixture, current, referenceSHA256, receipt);
});

test("altering the new unexpected-call failure is not an authorized insertion", () => {
  const altered = Buffer.from(current);
  altered[referenceOffset + 6] = altered[referenceOffset + 6]! ^ 1;
  assert.throws(() => verifyMapfileFixtureRevision(fixture, altered, referenceSHA256, receipt));
});

test("removing only the new insertion cannot admit the predecessor as the current fixture", () => {
  const predecessor = Buffer.concat([current.subarray(0, referenceOffset), current.subarray(referenceOffset + Buffer.byteLength(referenceInsertion))]);
  assert.equal(createHash("sha256").update(predecessor).digest("hex"), expectedRevision.insertions[1]!.beforeSHA256);
  assert.throws(() => verifyMapfileFixtureRevision(fixture, predecessor, referenceSHA256, receipt));
});

test("moving the new insertion cannot preserve admission", () => {
  const end = referenceOffset + Buffer.byteLength(referenceInsertion);
  const moved = Buffer.concat([current.subarray(0, referenceOffset - 1), current.subarray(referenceOffset, end), current.subarray(referenceOffset - 1, referenceOffset), current.subarray(end)]);
  assert.throws(() => verifyMapfileFixtureRevision(fixture, moved, referenceSHA256, receipt));
});

const mutations: readonly { name: string; change(revision: typeof expectedRevision): void }[] = [
  { name: "reordered insertions", change: revision => { revision.insertions.reverse(); } },
  { name: "missing historical insertion", change: revision => { revision.insertions.shift(); } },
  { name: "duplicate insertion", change: revision => { revision.insertions.push(revision.insertions[1]!); } },
  { name: "new insertion offset", change: revision => { revision.insertions[1]!.offset--; } },
  { name: "historical insertion bytes", change: revision => { revision.insertions[0]!.insertion += " "; } },
  { name: "new insertion bytes", change: revision => { revision.insertions[1]!.insertion += " "; } },
  { name: "intermediate predecessor hash", change: revision => { revision.insertions[1]!.beforeSHA256 = "0".repeat(64); } },
  { name: "intermediate result hash", change: revision => { revision.insertions[0]!.afterSHA256 = "0".repeat(64); } },
];
for (const mutation of mutations) test(`receipt rejects ${mutation.name}`, () => {
  const altered = structuredClone(expectedReceipt);
  mutation.change(altered.fixtures[0]!);
  assert.throws(() => verifyMapfileFixtureRevision(fixture, current, referenceSHA256, Buffer.from(JSON.stringify(altered, null, 2) + "\n")));
});

test("receipt rejects old receipt schema", () => {
  const altered = { ...expectedReceipt, schemaVersion: 2 };
  assert.throws(() => verifyMapfileFixtureRevision(fixture, current, referenceSHA256, Buffer.from(JSON.stringify(altered, null, 2) + "\n")));
});

test("syntax capability comparison reconstructs the entire original sealed test", () => {
  verifyMapfileFixtureRevision(syntaxFixture, syntaxCurrent, referenceSHA256, receipt);
  let reconstructed = Buffer.from(syntaxCurrent);
  for (const step of [...syntaxRevision.insertions].reverse()) {
    assert.equal(createHash("sha256").update(reconstructed).digest("hex"), step.afterSHA256);
    const insertion = Buffer.from(step.insertion);
    assert.deepEqual(reconstructed.subarray(step.offset, step.offset + insertion.length), insertion);
    reconstructed = Buffer.concat([reconstructed.subarray(0, step.offset), reconstructed.subarray(step.offset + insertion.length)]);
    assert.equal(createHash("sha256").update(reconstructed).digest("hex"), step.beforeSHA256);
  }
  assert.equal(createHash("sha256").update(reconstructed).digest("hex"), syntaxFixture.sha256);
});

for (const offset of [684, 721, 0, syntaxCurrent.length - 2]) test(`syntax fixture rejects insertion or surrounding drift at ${offset}`, () => {
  const altered = Buffer.from(syntaxCurrent);
  altered[offset] = altered[offset]! ^ 1;
  assert.throws(() => verifyMapfileFixtureRevision(syntaxFixture, altered, referenceSHA256, receipt));
});

test("syntax fixture rejects undoing only the second capability projection", () => {
  const step = syntaxRevision.insertions[1]!;
  const predecessor = Buffer.concat([syntaxCurrent.subarray(0, step.offset), syntaxCurrent.subarray(step.offset + Buffer.byteLength(step.insertion))]);
  assert.equal(createHash("sha256").update(predecessor).digest("hex"), step.beforeSHA256);
  assert.throws(() => verifyMapfileFixtureRevision(syntaxFixture, predecessor, referenceSHA256, receipt));
});

test("review and syntax fixture identities cannot be exchanged", () => {
  assert.throws(() => verifyMapfileFixtureRevision(syntaxFixture, current, referenceSHA256, receipt));
  assert.throws(() => verifyMapfileFixtureRevision(fixture, syntaxCurrent, referenceSHA256, receipt));
  assert.throws(() => verifyMapfileFixtureRevision({ ...syntaxFixture, sha256: fixture.sha256 }, syntaxCurrent, referenceSHA256, receipt));
  assert.throws(() => verifyMapfileFixtureRevision({ ...fixture, sha256: syntaxFixture.sha256 }, current, referenceSHA256, receipt));
});

test("receipt rejects transplanting the review insertion chain onto the syntax fixture", () => {
  const altered = structuredClone(expectedReceipt);
  altered.fixtures[1]!.insertions = altered.fixtures[0]!.insertions;
  assert.throws(() => verifyMapfileFixtureRevision(syntaxFixture, syntaxCurrent, referenceSHA256, Buffer.from(JSON.stringify(altered, null, 2) + "\n")));
});

test("syntax receipt offsets and intermediate hashes remain authenticated", () => {
  const moved = structuredClone(expectedReceipt);
  moved.fixtures[1]!.insertions[0]!.offset++;
  assert.throws(() => verifyMapfileFixtureRevision(syntaxFixture, syntaxCurrent, referenceSHA256, Buffer.from(JSON.stringify(moved, null, 2) + "\n")));
  const replaced = structuredClone(expectedReceipt);
  replaced.fixtures[1]!.insertions[1]!.beforeSHA256 = "0".repeat(64);
  assert.throws(() => verifyMapfileFixtureRevision(syntaxFixture, syntaxCurrent, referenceSHA256, Buffer.from(JSON.stringify(replaced, null, 2) + "\n")));
});

test("native reference remains the unchanged authenticated 170-record capture", () => {
  const bytes = readFileSync(new URL("./primary-reference.json", import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), referenceSHA256);
  const reference = JSON.parse(bytes.toString()) as { records: unknown[] };
  assert.equal(reference.records.length, 170);
  assert.equal(createHash("sha256").update(JSON.stringify(reference.records)).digest("hex"), "dd9767331874d5cb7262ec41986331010de8a8b0ef64b7884950549f0cfa074a");
});
