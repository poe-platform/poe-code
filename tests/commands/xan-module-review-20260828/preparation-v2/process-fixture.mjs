import { once } from 'node:events';
import { aggregate } from './supervisor.mjs';

const kind = process.argv[2];
async function emit(value) { if (!process.stdout.write(`${JSON.stringify(value)}\n`)) await once(process.stdout, 'drain'); }
if (kind === 'intentional-timeout') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else if (kind === 'large-stream' || kind === 'raw-overflow') {
  const target = kind === 'large-stream' ? 5 * 1024 * 1024 + 17 : 1024 * 1024;
  for (let offset = 0; offset < target; offset += 65536) {
    if (!process.stdout.write(Buffer.alloc(Math.min(65536, target - offset), 97))) await once(process.stdout, 'drain');
  }
} else if (kind === 'ordinary-failure') {
  await emit({ phase: 'ordinary-failure', complete: false }); process.exitCode = 7;
} else if (kind === 'missing-required-phase') {
  const result = await aggregate([{ id: 'required', run: async () => ({ reaped: true, closed: true, exitCode: 0,
    rawBoundExceeded: false, requiredPhase: 'required', completedPhase: null }), assert() {} }], async () => {}, emit);
  await emit({ aggregate: result }); process.exitCode = result.exitCode;
} else {
  await emit({ phase: 'ordinary-success', complete: true });
}
