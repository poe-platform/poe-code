import { fileURLToPath } from 'node:url';
import { assertClosed, run } from './tools.mjs';

const result = await run('independent-guards', process.execPath, [
  '--unhandled-rejections=strict', '--import', 'tsx', fileURLToPath(new URL('negatives.mjs', import.meta.url)),
], { timeoutMs: 15000, extraEnv: { HARNESS_TIMING: '1' } });
assertClosed(result);
console.log(JSON.stringify({ code: result.code, durationMs: result.durationMs, pid: result.pid, closeSeen: result.closeSeen }));
