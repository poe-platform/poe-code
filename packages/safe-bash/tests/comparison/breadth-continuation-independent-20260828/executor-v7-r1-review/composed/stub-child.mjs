import fs from 'node:fs';
import { transport } from '../../../breadth-continuation-20260828/executor-v7-r1/transport.mjs';

const mode = process.argv[2];
if (!['pass', 'exit7', 'wait-term'].includes(mode)) throw new Error('UNSEALED_CHILD_MODE');
const writer = transport();
writer.emit({ kind: 'final', report: { exportEvaluation: true, fixtureOnly: true, mode } });
if (mode === 'exit7') process.exitCode = 7;
if (mode === 'wait-term') {
  const timer = setInterval(() => {}, 1000);
  process.once('SIGTERM', () => { clearInterval(timer); process.exitCode = 0; });
}
fs.writeSync(1, Buffer.from('SYNTHETIC_STUB\n'));
