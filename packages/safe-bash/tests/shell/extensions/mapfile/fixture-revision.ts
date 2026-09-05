import assert from "node:assert/strict";
import { createHash } from "node:crypto";

interface FixtureRevision {
  readonly schemaVersion: number;
  readonly referenceSHA256: string;
  readonly fixture: string;
  readonly originalSHA256: string;
  readonly currentSHA256: string;
  readonly offset: number;
  readonly insertion: string;
}

export function verifyMapfileFixtureRevision(fixture: { readonly file: string; readonly sha256: string }, current: Uint8Array, referenceSHA256: string, receipt: Uint8Array): void {
  assert.ok(receipt.byteLength <= 4096, "Fixture revision receipt exceeds its bound");
  assert.ok(current.byteLength <= 65536, "Revised fixture exceeds its bound");
  assert.equal(createHash("sha256").update(receipt).digest("hex"), "7f09101e627d9d3e32663bca9aef5368edab48cb64dc909dc3b67480a445ecee");
  const revision = JSON.parse(Buffer.from(receipt).toString()) as FixtureRevision;
  assert.equal(revision.schemaVersion, 1);
  assert.equal(revision.fixture, "review.test.ts");
  assert.equal(fixture.file, revision.fixture);
  assert.equal(referenceSHA256, revision.referenceSHA256);
  assert.equal(fixture.sha256, revision.originalSHA256);
  assert.equal(createHash("sha256").update(current).digest("hex"), revision.currentSHA256);
  assert.ok(Number.isSafeInteger(revision.offset) && revision.offset >= 0);
  const insertion = Buffer.from(revision.insertion);
  assert.ok(revision.offset + insertion.byteLength <= current.byteLength);
  assert.deepEqual(Buffer.from(current.subarray(revision.offset, revision.offset + insertion.byteLength)), insertion);
  const reconstructed = Buffer.concat([current.subarray(0, revision.offset), current.subarray(revision.offset + insertion.byteLength)]);
  assert.equal(createHash("sha256").update(reconstructed).digest("hex"), fixture.sha256);
}
