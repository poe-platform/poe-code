import { parentPort, Worker } from 'node:worker_threads';
import { answer } from './matching.mjs';
import { identity } from './protocol.mjs';
import { finish } from './bre-worker.mjs';
if (!parentPort) throw Error('NO_PARENT');
parentPort.on('message', async message => {
  if (message.action === 'escape') { try { await import('./foreign.mjs'); } catch {} }
  if (message.action === 'builtin') { try { await import('node:fs'); } catch {} }
  if (message.action === 'recursive') { try { new Worker(new URL('./worker.mjs', import.meta.url)); } catch {} }
  parentPort.postMessage({ kind: 'result', value: finish(identity(answer())) });
});
parentPort.postMessage({ kind: 'ready' });
