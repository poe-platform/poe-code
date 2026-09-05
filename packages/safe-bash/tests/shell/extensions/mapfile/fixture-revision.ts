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

export function verifyMapfileFixtureRevision(fixture: { readonly file: string; readonly sha256: string }, current: Uint8Array, referenceSHA256: string, receipt: Uint8Array): void {
  assert.ok(receipt.byteLength <= 4096, "Fixture revision receipt exceeds its bound");
  assert.ok(current.byteLength <= 65536, "Revised fixture exceeds its bound");
  assert.equal(createHash("sha256").update(receipt).digest("hex"), "b07cc2354705898b8da94433f47c9cf59eae3bf9045622ef720b434b0708ed09");
  const revisions = JSON.parse(Buffer.from(receipt).toString()) as FixtureRevisions;
  assert.equal(revisions.schemaVersion, 3);
  assert.equal(referenceSHA256, revisions.referenceSHA256);
  assert.ok(Array.isArray(revisions.fixtures));
  assert.equal(revisions.fixtures.length, 2);
  const revision: FixtureRevision | undefined = revisions.fixtures.find((entry: FixtureRevision) => entry.fixture === fixture.file);
  assert.ok(revision, "Unknown revised fixture");
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
