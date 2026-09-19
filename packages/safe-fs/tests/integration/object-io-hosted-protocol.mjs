import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export async function consumeObjectIoResponse({ response, expectedBytes, sequentialSha256, positionedSha256 }) {
  assert.equal(response.status, 200, 'Hosted qualification response must succeed');
  assert.equal(response.headers.get('Content-Type')?.split(';')[0], 'application/x-ndjson');
  assert.ok(response.body, 'Hosted qualification requires a streamed response');
  assert.ok(Number.isSafeInteger(expectedBytes) && expectedBytes > 0);
  const digest = createHash('sha256');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let canonicalRecords = 0;
  let buffered = '';
  let summary;
  for await (const chunk of response.body) {
    buffered += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffered.indexOf('\n')) !== -1) {
      assert.ok(newline <= 131072, 'Hosted response record exceeds bounded size');
      assert.equal(summary, undefined, 'No records may follow the final summary');
      const record = JSON.parse(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
      if (record.type === 'chunk') {
        assert.equal(record.offset, bytes, 'Canonical chunks must be contiguous');
        assert.equal(typeof record.base64, 'string');
        const decoded = Buffer.from(record.base64, 'base64');
        assert.ok(decoded.length > 0 && decoded.length <= 65536, 'Canonical chunks must be bounded');
        assert.equal(decoded.toString('base64'), record.base64, 'Canonical chunk encoding must be exact');
        bytes += decoded.length;
        assert.ok(bytes <= expectedBytes, 'Canonical stream exceeds expected bytes');
        digest.update(decoded);
        canonicalRecords++;
      } else {
        assert.equal(record.type, 'summary');
        assert.equal(record.completed, true, 'Summary must follow completed readback and cleanup');
        summary = record;
      }
    }
    assert.ok(buffered.length <= 131072, 'Hosted response record exceeds bounded size');
  }
  assert.equal(buffered + decoder.decode(), '', 'Final summary must end with a newline');
  assert.ok(summary, 'Canonical stream requires a final summary');
  assert.equal(bytes, expectedBytes);
  assert.equal(summary.canonicalBytes, bytes);
  assert.equal(summary.independentReadback?.size, bytes);
  assert.equal(summary.exitCode, 0);
  assert.equal(summary.stderr, '');
  assert.deepEqual(summary.failures, []);
  assert.deepEqual(summary.unhandledWorkerErrors, []);
  assert.equal(summary.privatePagesAfterCleanup, 0);
  assert.equal(summary.fixtureObjectsAfterCleanup, 0);
  assert.equal(summary.stdout, `${sequentialSha256}\n${positionedSha256}\n`);
  assert.equal(summary.events?.acquired, summary.events?.released);
  assert.equal(summary.events?.created, summary.events?.closed);
  assert.equal(summary.events?.activeWrites, 0);
  assert.equal(summary.events?.peakWrites, 1);
  assert.ok(Number.isSafeInteger(summary.events?.largestChunk) && summary.events.largestChunk > 0);
  assert.equal(summary.phases?.canonicalStream?.operations?.['stream.read']?.count,
    canonicalRecords + 1);
  assert.ok(summary.phases?.fixtureCleanup, 'Final summary requires cleanup phase evidence');
  const canonicalHash = digest.digest('hex');
  assert.equal(canonicalHash, positionedSha256, 'Independent canonical hash must match Python');
  return { ...summary, canonicalHash };
}

export function admitHostedObjectIoCleanup(receipt, expectedOwner) {
  assert.equal(receipt?.owner, expectedOwner, 'Hosted cleanup owner must match the fresh Worker');
  assert.equal(receipt?.remainingObjects, 0, 'Hosted cleanup must verify no remaining objects');
  assert.equal(receipt?.truncated, false, 'Hosted cleanup must finish listing the bucket');
  assert.ok(Number.isSafeInteger(receipt?.listedPages) && receipt.listedPages >= 1 && receipt.listedPages <= 32);
  assert.ok(Number.isSafeInteger(receipt?.removedObjects) && receipt.removedObjects >= 0 && receipt.removedObjects <= 3200);
  return { ...receipt, empty: true };
}
