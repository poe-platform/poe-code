import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { consumeObjectIoResponse } from './object-io-hosted-protocol.mjs';

export async function qualifyHostedObjectIoMatrix({ request, protocol, wait = setTimeout }) {
  let ready = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    let response;
    try { response = await request('/ready'); }
    catch (error) {
      if (attempt === 11) throw error;
      await wait(5000);
      continue;
    }
    const status = response.status;
    await response.body?.cancel();
    if (status === 200) { ready = true; break; }
    assert.ok([404, 503].includes(status), `Hosted readiness failed with status ${status}`);
    if (attempt < 11) await wait(5000);
  }
  assert.ok(ready, 'Hosted Worker did not become ready');
  const conformanceResponse = await request('/conformance');
  assert.equal(conformanceResponse.status, 200, 'Hosted storage conformance must succeed');
  const conformance = await conformanceResponse.json();
  assert.ok(Array.isArray(conformance) && conformance.length === 8 && new Set(conformance).size === 8);
  const rows = [];
  for (const delayMs of [0, 5]) {
    for (const { chunkBytes, callerBytes, maxTransferBytes, profile, pages } of [
      { chunkBytes: 65536, callerBytes: 65536, maxTransferBytes: 65536, profile: 'matched-64KiB', pages: [1, 4, 16] },
      { chunkBytes: 262144, callerBytes: 262144, maxTransferBytes: 262144, profile: 'matched-256KiB', pages: [1, 4] },
      { chunkBytes: 1048576, callerBytes: 1048576, maxTransferBytes: 1048576, profile: 'matched-1MiB', pages: [1] },
      { chunkBytes: 262144, callerBytes: 65536, maxTransferBytes: 65536, profile: 'mismatch-256KiB-page-64KiB-io', pages: [1, 4] },
    ]) {
      for (const workingPages of pages) {
        const started = performance.now();
        const configuration = { size: protocol.size, chunkBytes, workingPages, delayMs, callerBytes, maxTransferBytes };
        const query = new URLSearchParams(Object.entries(configuration).map(([name, value]) => [name, String(value)]));
        const response = await request(`/object-io-781?${query}`);
        const streamStarted = performance.now();
        const row = await consumeObjectIoResponse({ response, expectedBytes: protocol.size,
          sequentialSha256: protocol.expectedSequentialSha256, positionedSha256: protocol.expectedPositionedSha256 });
        assert.equal(row.owner, protocol.owner, 'Hosted final summary must belong to the fresh qualification Worker');
        assert.equal(row.maxResidentPageBytes, chunkBytes * workingPages);
        assert.ok(row.events.largestChunk <= chunkBytes);
        assert.ok(Number.isSafeInteger(row.initialWasmMemoryBytes) && row.initialWasmMemoryBytes > 0);
        assert.ok(Number.isSafeInteger(row.finalWasmMemoryBytes) && row.finalWasmMemoryBytes >= row.initialWasmMemoryBytes);
        assert.equal(row.phases.sequentialWrite?.operations?.['syscall.write']?.count,
          protocol.size / Math.min(callerBytes, maxTransferBytes));
        assert.equal(row.phases.positionedIO?.operations?.['syscall.write']?.count, 12);
        assert.equal(row.phases.positionedIO?.operations?.['syscall.read']?.count, 13);
        rows.push({ ...row, ...configuration, profile,
          hostStreamReadbackMs: performance.now() - streamStarted, caseElapsedMs: performance.now() - started });
      }
    }
  }
  const errorsResponse = await request('/unhandled-errors');
  assert.equal(errorsResponse.status, 200, 'Hosted final runtime error collection must succeed');
  assert.deepEqual(await errorsResponse.json(), [], 'Zero hosted Worker errors required after final drain');
  assert.equal(rows.length, 16);
  return { conformance, rows, qualification: 'Hosted Cloudflare Worker and R2 with actual Python, independently hashed canonical bytes; optional synthetic delay is identified per row.' };
}
