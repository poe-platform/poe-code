import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { compose } from './composition.mjs';
import { home } from './auth.mjs';
import { transport } from '../../../breadth-continuation-20260828/executor-v7-r1/transport.mjs';

const mode = process.argv[2];
assert.ok(['positive', 'exit7', 'overflow', 'postflight'].includes(mode));
const base = path.join(home, 'evidence-01', `outer-${mode}-body`);
const result = await compose(base, 'synthetic', { exitCode: mode === 'exit7' ? 7 : 0 });
transport().emit({ kind: 'final', report: { fixtureOnly: true, allPass: result.output.controls.rows.every(row => row.pass), children: result.ledger.length, status: result.publication.status } });
const bytes = Buffer.concat(result.streams.stdout);
fs.writeSync(1, bytes);
process.exitCode = result.publication.exitCode;
if (mode === 'overflow') {
  const timer = setInterval(() => {}, 1000);
  process.once('SIGTERM', () => { clearInterval(timer); process.exitCode = 0; });
  fs.writeSync(1, Buffer.alloc(65537 - bytes.length, 32));
}
