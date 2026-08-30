import fs from 'node:fs';
import path from 'node:path';
import { author, inherited, url, authenticate } from './auth.mjs';

authenticate();
const { createStore } = await import(url(path.join(author, 'records.mjs')));
const { publish } = await import(url(path.join(author, 'publisher.mjs')));
const { createLedger } = await import(url(path.join(inherited, 'launch-ledger.mjs')));
const mode = process.argv[2];
const root = process.argv[3];
if (!['positive', 'exit7', 'stdout-failure', 'overflow'].includes(mode)) throw new Error('STUB_MODE');
if (mode === 'overflow') process.on('SIGTERM', () => { process.exitCode = 0; });
const writeStream = (descriptor, bytes) => {
  if (mode === 'stdout-failure' && descriptor === 1) throw Object.assign(new Error('INDEPENDENT_STDOUT'), { code: 'INDEPENDENT_STDOUT' });
  let output = bytes;
  if (mode === 'overflow' && descriptor === 1) output = Buffer.concat([bytes, Buffer.alloc(65537 - bytes.length, 32)]);
  let offset = 0;
  while (offset < output.length) offset += fs.writeSync(descriptor, output, offset, output.length - offset);
};
const result = publish({ output: { mode: 'admission', runId: mode, status: 'ADMISSION_ACCEPTED', unsafe: false, controls: { rows: [{ id: 'INDEPENDENT_STUB', pass: true }] } }, ledger: createLedger(0), store: createStore(root), writeStream });
fs.writeSync(3, `${JSON.stringify({ sequence: 0, kind: 'final', report: { allPass: true, mode } })}\n`);
process.exitCode = mode === 'exit7' ? 7 : result.exitCode;
