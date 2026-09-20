import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createObjectIo781Runtime } from './python-object-io-781.runtime.mjs';

function expectedHash(positioned) {
  const digest = createHash('sha256');
  const chunk = Buffer.alloc(65536);
  for (let offset = 0; offset < chunk.length; offset++) chunk[offset] = offset % 256;
  for (let index = 0; index < 144; index++) {
    if (positioned && index < 16 && index % 4 === 0) chunk[3] = 242;
    digest.update(chunk);
    chunk[3] = 3;
  }
  return digest.digest('hex');
}

test('issue 781 actual Python/native same-isolate delayed object I/O matrix', { timeout: 180000 }, async context => {
  const runtime = await createObjectIo781Runtime(context);
  const { miniflare, runtimeErrors, receipt, requestOptions } = runtime;
  const rows = [];
  try {
    const unauthorized = await miniflare.dispatchFetch('http://fixture/ready', { method: 'POST', headers: { 'Content-Length': '0' } });
    assert.equal(unauthorized.status, 401);
    const readiness = await miniflare.dispatchFetch('http://fixture/ready', requestOptions);
    assert.equal(readiness.status, 200);
    const ready = await readiness.json();
    assert.equal(ready.ready, true);
    assert.equal(ready.owner, 'local-issue-781-qualification');
    assert.equal(ready.active, false);
    const protocol = await miniflare.dispatchFetch('http://fixture/conformance', requestOptions);
    const conformance = await protocol.json();
    assert.equal(protocol.status, 200, JSON.stringify(conformance));
    assert.equal(conformance.length, 8);
    for (const delayMs of [0, 5]) {
      for (const { chunkBytes, callerBytes, maxTransferBytes, profile, pages } of [
        { chunkBytes: 65536, callerBytes: 65536, maxTransferBytes: 65536, profile: 'matched-64KiB', pages: [1, 4, 16] },
        { chunkBytes: 262144, callerBytes: 262144, maxTransferBytes: 262144, profile: 'matched-256KiB', pages: [1, 4] },
        { chunkBytes: 1048576, callerBytes: 1048576, maxTransferBytes: 1048576, profile: 'matched-1MiB', pages: [1] },
        { chunkBytes: 262144, callerBytes: 65536, maxTransferBytes: 65536, profile: 'mismatch-256KiB-page-64KiB-io', pages: [1, 4] },
      ]) {
        for (const workingPages of pages) {
          const started = performance.now();
          const response = await miniflare.dispatchFetch(`http://fixture/object-io-781?size=9437184&chunkBytes=${chunkBytes}&workingPages=${workingPages}&delayMs=${delayMs}&callerBytes=${callerBytes}&maxTransferBytes=${maxTransferBytes}`, requestOptions);
          if (response.status !== 200) assert.fail(await response.text());
          const streamStarted = performance.now();
          const digest = createHash('sha256');
          let bytes = 0;
          let row;
          let buffered = '';
          const decoder = new TextDecoder();
          for await (const chunk of response.body) {
            buffered += decoder.decode(chunk, { stream: true });
            let newline;
            while ((newline = buffered.indexOf('\n')) !== -1) {
              const record = JSON.parse(buffered.slice(0, newline));
              buffered = buffered.slice(newline + 1);
              assert.equal(row, undefined, 'No records may follow the final summary');
              if (record.type === 'chunk') {
                assert.equal(record.offset, bytes);
                const decoded = Buffer.from(record.base64, 'base64');
                assert.ok(decoded.length > 0 && decoded.length <= 65536);
                digest.update(decoded);
                bytes += decoded.length;
              } else {
                assert.equal(record.type, 'summary');
                assert.equal(record.completed, true);
                row = record;
              }
            }
          }
          assert.equal(buffered + decoder.decode(), '');
          assert.ok(row, 'Completed canonical stream and cleanup must produce a final summary');
          row.profile = profile;
          row.hostStreamReadbackMs = performance.now() - streamStarted;
          row.caseElapsedMs = performance.now() - started;
          row.canonicalHash = digest.digest('hex');
          assert.equal(row.exitCode, 0, JSON.stringify(row));
          assert.equal(row.stderr, '', JSON.stringify(row));
          assert.deepEqual(row.failures, []);
          assert.deepEqual(row.stdout.trim().split('\n'), [expectedHash(false), expectedHash(true)]);
          assert.equal(row.canonicalHash, expectedHash(true));
          assert.equal(bytes, 9437184);
          assert.equal(row.independentReadback.size, bytes);
          assert.equal(row.canonicalBytes, bytes);
          assert.deepEqual(row.unhandledWorkerErrors, []);
          assert.equal(row.owner, ready.owner);
          assert.equal(row.privatePagesAfterCleanup, 0);
          assert.equal(row.fixtureObjectsAfterCleanup, 0);
          assert.equal(row.events.acquired, row.events.released);
          assert.equal(row.events.created, row.events.closed);
          assert.equal(row.events.peakWrites, 1);
          assert.ok(row.events.largestChunk <= chunkBytes);
          assert.equal(row.phases.sequentialWrite.operations['syscall.write'].count, 9437184 / Math.min(callerBytes, maxTransferBytes));
          assert.equal(row.phases.positionedIO.operations['syscall.write'].count, 12);
          assert.equal(row.phases.positionedIO.operations['syscall.read'].count, 13);
          assert.equal(row.phases.canonicalStream.operations['stream.read'].count, 145);
          rows.push(row);
          context.diagnostic(JSON.stringify(row));
        }
      }
    }
    const errorResponse = await miniflare.dispatchFetch('http://fixture/unhandled-errors', requestOptions);
    assert.equal(errorResponse.status, 200);
    assert.deepEqual(await errorResponse.json(), [], 'Zero unhandled Worker errors required');
    assert.deepEqual(runtimeErrors, [], 'Zero runtime errors required');
    const bucket = await miniflare.getR2Bucket('SCRATCH');
    assert.equal((await bucket.list()).objects.length, 0, 'All canonical and private fixture objects must be removed');
    await bucket.put('owned-failed-case-recovery', new Uint8Array([1]));
    const cleanupResponse = await miniflare.dispatchFetch('http://fixture/cleanup', requestOptions);
    assert.equal(cleanupResponse.status, 200);
    assert.deepEqual(await cleanupResponse.json(), { owner: ready.owner, expiresAt: ready.expiresAt,
      removedObjects: 1, listedPages: 2, remainingObjects: 0, truncated: false });
    assert.equal((await bucket.list()).objects.length, 0);
    await writeFile(resolve(process.env.TMPDIR, 'results.json'), JSON.stringify({ receipt, conformance, rows, runtimeErrors,
      qualification: 'Local authentic Miniflare/workerd only. Synthetic per-request delay, not Cloudflare latency or a hosted qualification.' }, null, 2) + '\n');
    await runtime.exportQualified({ conformance, rows, runtimeErrors });
  } catch (error) {
    context.diagnostic('Primary failure: ' + String(error));
    throw error;
  } finally {
    await miniflare.dispose();
    assert.deepEqual(runtimeErrors, [], 'Zero runtime errors required through disposal');
  }
});
