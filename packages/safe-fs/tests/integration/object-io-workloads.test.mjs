import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { objectIoCases, largeObjectIoWorkload } from './object-io-workloads.mjs';

test('large qualification keeps 1600 guest writes and a single 64 KiB page', () => {
  const cases = objectIoCases({ size: 9437184, largeWorkload: largeObjectIoWorkload });
  assert.equal(cases.length, 17);
  assert.equal(new Set(cases.map(({ configuration }) => JSON.stringify(configuration))).size, 17);
  const { configuration, workload } = cases.at(-1);
  assert.deepEqual(configuration, { size: 104857600, chunkBytes: 65536,
    workingPages: 1, delayMs: 0, callerBytes: 65536, maxTransferBytes: 65536 });
  assert.equal(configuration.size / configuration.callerBytes, 1600);
  assert.equal(workload, largeObjectIoWorkload);
});

test('pinned large workload hashes match the independently generated bounded byte stream', () => {
  const sequential = createHash('sha256');
  const positioned = createHash('sha256');
  const chunk = Buffer.alloc(65536);
  for (let index = 0; index < chunk.length; index++) chunk[index] = index % 256;
  for (let offset = 0; offset < largeObjectIoWorkload.size; offset += chunk.length) {
    sequential.update(chunk);
    const changed = offset < 1048576 && offset % 262144 === 0;
    if (changed) chunk[3] = 242;
    positioned.update(chunk);
    chunk[3] = 3;
  }
  assert.equal(sequential.digest('hex'), largeObjectIoWorkload.expectedSequentialSha256);
  assert.equal(positioned.digest('hex'), largeObjectIoWorkload.expectedPositionedSha256);
});
