import assert from "node:assert/strict";
import { createHash } from "node:crypto";

interface FixtureRevision {
  readonly fixture: string;
  readonly originalSHA256: string;
  readonly currentSHA256: string;
  readonly insertions: readonly {
    readonly beforeSHA256: string;
    readonly afterSHA256: string;
    readonly offset: number;
    readonly insertion: string;
  }[];
}

interface FixtureRevisions {
  readonly schemaVersion: number;
  readonly referenceSHA256: string;
  readonly fixtures: readonly FixtureRevision[];
}

interface ReplacementRevision {
  readonly schemaVersion: number;
  readonly referenceSHA256: string;
  readonly predecessorReceiptSHA256: string;
  readonly predecessor: FixtureRevisions;
  readonly revisions: readonly {
    readonly fixture: string;
    readonly previousSHA256: string;
    readonly currentSHA256: string;
    readonly replacements: readonly { readonly beforeSHA256: string; readonly afterSHA256: string; readonly offset: number; readonly removed: string; readonly insertion: string }[];
  }[];
}

export function verifyMapfileFixtureRevision(fixture: { readonly file: string; readonly sha256: string }, current: Uint8Array, referenceSHA256: string, receipt: Uint8Array): void {
  assert.ok(receipt.byteLength <= 16384, "Fixture revision receipt exceeds its bound");
  assert.ok(current.byteLength <= 65536, "Revised fixture exceeds its bound");
  assert.equal(createHash("sha256").update(receipt).digest("hex"), "4bf5b0b10a1282e92579f8a3f05beaa69081fa738af4cc800d58cd1466dbf0c0");
  const replacement = JSON.parse(Buffer.from(receipt).toString()) as ReplacementRevision;
  assert.equal(replacement.schemaVersion, 4);
  assert.equal(referenceSHA256, replacement.referenceSHA256);
  assert.equal(replacement.predecessorReceiptSHA256, "b07cc2354705898b8da94433f47c9cf59eae3bf9045622ef720b434b0708ed09");
  assert.equal(createHash("sha256").update(JSON.stringify(replacement.predecessor, null, 2) + "\n").digest("hex"), replacement.predecessorReceiptSHA256);
  assert.deepEqual(replacement.revisions.map(entry => entry.fixture), ["arguments.test.ts", "behavior.test.ts", "review.test.ts", "evaluation-exit-review.test.ts", "callback-boundary.test.ts", "syntax.test.ts"]);
  const update = replacement.revisions.find(entry => entry.fixture === fixture.file);
  if (update) {
    assert.equal(createHash("sha256").update(current).digest("hex"), update.currentSHA256);
    assert.ok(update.replacements.length > 0 && update.replacements.length <= 8);
    for (const step of [...update.replacements].reverse()) {
      assert.equal(createHash("sha256").update(current).digest("hex"), step.afterSHA256);
      assert.ok(Number.isSafeInteger(step.offset) && step.offset >= 0);
      assert.equal(typeof step.insertion, "string");
      assert.equal(typeof step.removed, "string");
      const inserted = Buffer.from(step.insertion);
      assert.ok(inserted.length > 0 && step.offset <= current.length - inserted.length);
      assert.deepEqual(Buffer.from(current.subarray(step.offset, step.offset + inserted.length)), inserted);
      current = Buffer.concat([current.subarray(0, step.offset), Buffer.from(step.removed), current.subarray(step.offset + inserted.length)]);
      assert.ok(current.byteLength <= 65536, "Reconstructed fixture exceeds its bound");
      assert.equal(createHash("sha256").update(current).digest("hex"), step.beforeSHA256);
    }
    assert.equal(createHash("sha256").update(current).digest("hex"), update.previousSHA256);
  }
  const revisions = replacement.predecessor;
  assert.equal(revisions.schemaVersion, 3);
  assert.equal(referenceSHA256, revisions.referenceSHA256);
  assert.ok(Array.isArray(revisions.fixtures));
  assert.equal(revisions.fixtures.length, 2);
  const revision: FixtureRevision | undefined = revisions.fixtures.find((entry: FixtureRevision) => entry.fixture === fixture.file);
  if (!revision) {
    assert.ok(update, "Unknown revised fixture");
    assert.equal(createHash("sha256").update(current).digest("hex"), fixture.sha256);
    return;
  }
  assert.equal(fixture.file, revision.fixture);
  assert.equal(fixture.sha256, revision.originalSHA256);
  assert.equal(createHash("sha256").update(current).digest("hex"), revision.currentSHA256);
  assert.ok(Array.isArray(revision.insertions));
  assert.equal(revision.insertions.length, 2);
  let reconstructed = Buffer.from(current);
  for (let index = revision.insertions.length - 1; index >= 0; index--) {
    const step: FixtureRevision["insertions"][number] = revision.insertions[index]!;
    assert.equal(createHash("sha256").update(reconstructed).digest("hex"), step.afterSHA256);
    assert.ok(Number.isSafeInteger(step.offset) && step.offset >= 0);
    assert.equal(typeof step.insertion, "string");
    const insertion = Buffer.from(step.insertion);
    assert.ok(insertion.byteLength > 0 && step.offset <= reconstructed.byteLength - insertion.byteLength);
    assert.deepEqual(reconstructed.subarray(step.offset, step.offset + insertion.byteLength), insertion);
    reconstructed = Buffer.concat([reconstructed.subarray(0, step.offset), reconstructed.subarray(step.offset + insertion.byteLength)]);
    assert.equal(createHash("sha256").update(reconstructed).digest("hex"), step.beforeSHA256);
  }
  assert.equal(createHash("sha256").update(reconstructed).digest("hex"), fixture.sha256);
}
