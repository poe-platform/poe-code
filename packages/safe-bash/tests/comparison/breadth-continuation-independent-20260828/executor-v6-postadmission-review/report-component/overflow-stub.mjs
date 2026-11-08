import fs from 'node:fs';
import path from 'node:path';
import { author, inherited, url } from './auth.mjs';
import { authenticateCorrection } from './correction-auth.mjs';

authenticateCorrection(true);
const { createStore } = await import(url(path.join(author, 'records.mjs')));
const { publish } = await import(url(path.join(author, 'publisher.mjs')));
const { createLedger } = await import(url(path.join(inherited, 'launch-ledger.mjs')));
const keepAlive = setInterval(() => {}, 1000);
process.once('SIGTERM', () => {
  clearInterval(keepAlive);
  fs.writeSync(3, `${JSON.stringify({ sequence: 0, kind: 'final', report: { intervalRetired: true, activeResources: process.getActiveResourcesInfo().filter(name => !['PipeWrap', 'TTYWrap'].includes(name)) } })}\n`);
  process.exitCode = 0;
});
try {
  const outcome = publish({ output: { mode: 'admission', runId: 'corrected-overflow', status: 'ADMISSION_ACCEPTED', unsafe: false, controls: { rows: [{ pass: true }] } }, ledger: createLedger(0), store: createStore(process.argv[2]), writeStream(descriptor, bytes) {
    const output = descriptor === 1 ? Buffer.concat([bytes, Buffer.alloc(65537 - bytes.length, 32)]) : bytes;
    let offset = 0;
    while (offset < output.length) offset += fs.writeSync(descriptor, output, offset, output.length - offset);
  } });
  if (outcome.exitCode !== 0) { clearInterval(keepAlive); process.exitCode = outcome.exitCode; }
} catch (error) { clearInterval(keepAlive); throw error; }
