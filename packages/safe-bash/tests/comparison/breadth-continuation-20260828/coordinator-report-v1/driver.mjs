import fs from 'node:fs';
import { createStore } from './records.mjs';
import { publish } from './publisher.mjs';

const mode = process.argv[2];
const root = process.argv[3];
if (!['positive', 'post-summary-nonzero', 'stdout-failure'].includes(mode)) throw new Error('SYNTHETIC_DRIVER_MODE');
const ledger = { entries: [], summary: () => ({ enrolled: 0, attempted: 0, launched: 0, closed: 0, unknownAcquisitions: 0, allChildrenReaped: null, unsafe: false }) };
const store = createStore(root);
const result = publish({ output: { mode: 'admission', runId: `SYNTHETIC-${mode}`, status: 'ADMISSION_ACCEPTED', unsafe: false, explicitlySyntheticNoEngines: true }, ledger, store, writeStream: (descriptor, bytes) => {
  if (mode === 'stdout-failure' && descriptor === 1) throw Object.assign(new Error('synthetic EPIPE'), { code: 'EPIPE' });
  fs.writeSync(descriptor, bytes);
} });
fs.writeSync(3, `${JSON.stringify({ sequence: 0, kind: 'final', report: { explicitlySyntheticNoEngines: true, mode, publisherStatus: result.status, publisherExit: result.exitCode } })}\n`);
process.exitCode = mode === 'post-summary-nonzero' ? 7 : result.exitCode;
