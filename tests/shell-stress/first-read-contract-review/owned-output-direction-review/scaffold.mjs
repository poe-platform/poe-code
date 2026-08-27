import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOpaqueBorrowedInput } from './probes.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../../../..');
const expectedSeal = 'eb2fde0beb13aeb738019309c6db9ec8aa4ab9694a82d3f35efc1cbfae0527ae';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = name => JSON.parse(readFileSync(resolve(directory, name), 'utf8'));

export function verifyPreparation() {
  const sealBytes = readFileSync(resolve(directory, 'freeze.json'));
  assert.equal(sha256(sealBytes), expectedSeal, 'Independent seal changed');
  const freeze = JSON.parse(sealBytes);
  const records = [...freeze.files, ...freeze.priorIndependent.files];
  for (const record of records) {
    const bytes = readFileSync(resolve(repository, record.path));
    assert.equal(bytes.length, record.bytes, `Size changed: ${record.path}`);
    assert.equal(sha256(bytes), record.sha256, `Hash changed: ${record.path}`);
  }
  const plan = readJson('cases.json');
  const inputs = readJson('inputs.json');
  assert.equal(plan.logicalCaseCount, 7);
  assert.equal(plan.maximumLogicalCaseCount, 7);
  assert.deepEqual(plan.cases.map(entry => entry.id), ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07']);
  for (const entry of plan.cases) {
    assert.ok(Object.hasOwn(inputs, entry.input), `Missing input ${entry.input}`);
    assert.ok(entry.required.length && entry.workflow.length && entry.bindingBlockers.length);
  }
  assert.equal(inputs.failureReasons.subruns.length, 4);
  assert.equal(new TextEncoder().encode(inputs.mixedCurl.responseBody).length, 16);
  assert.equal(inputs.mixedCurl.borrowedChunks.join(''), inputs.mixedCurl.uploadBytes);
  return {
    classification: 'PREPARATION_INTEGRITY_ONLY_NOT_PRODUCT_ACCEPTANCE',
    logicalCaseCount: 7,
    maximumLogicalCaseCount: 7,
    productExecuted: 0,
    productPassed: null,
    pending: plan.cases.map(entry => entry.id),
    frozenFilesVerified: freeze.files.length,
    historicalFilesVerified: freeze.priorIndependent.files.length,
    sealSha256: expectedSeal
  };
}

export async function checkProbeScaffolding() {
  const source = createOpaqueBorrowedInput(['first\n', 'owner\n']);
  const pending = source.iterator.next();
  assert.equal(source.snapshot().pending, true);
  assert.equal(source.snapshot().deliveredChunks, 0);
  source.release();
  assert.equal(new TextDecoder().decode((await pending).value), 'first\n');
  const rejected = source.iterator.next();
  const reason = new Error('scaffold-controlled-rejection');
  const rejectionCheck = assert.rejects(rejected, error => error === reason);
  source.reject(reason);
  await rejectionCheck;
  const owner = source.iterator.next();
  source.release();
  assert.equal(new TextDecoder().decode((await owner).value), 'owner\n');
  const eof = source.iterator.next();
  source.release();
  assert.equal((await eof).done, true);
  assert.deepEqual(source.snapshot().counts, { next: 4, returned: 0, canceled: 0, closed: 0, rejected: 1 });

  const destructive = createOpaqueBorrowedInput(['late\n']);
  const opaquePending = destructive.iterator.next();
  await destructive.iterator.return();
  assert.equal(destructive.snapshot().pending, true);
  destructive.release();
  assert.equal(new TextDecoder().decode((await opaquePending).value), 'late\n');
  assert.equal(destructive.snapshot().counts.returned, 1);
  return { classification: 'SYNTHETIC_PROBE_CHECK_ONLY', productExecuted: 0, productPassed: null };
}

export function productExecutionUnavailable() {
  throw new Error('PREPARATION_ONLY: no authenticated v2 binding or product driver; run is unavailable');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? 'verify';
  try {
    if (mode === 'verify') {
      console.log(JSON.stringify(verifyPreparation(), null, 2));
    } else if (mode === 'check-probes') {
      verifyPreparation();
      console.log(JSON.stringify(await checkProbeScaffolding(), null, 2));
    } else {
      productExecutionUnavailable();
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
