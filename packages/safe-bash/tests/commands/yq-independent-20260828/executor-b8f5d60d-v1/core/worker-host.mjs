import { pathToFileURL } from 'node:url';
import { assertTree, canonical, describeError, inside, keys, readBoundJson, requireFact } from './primitives.mjs';
import { createWorkerApi } from './worker-api.mjs';

const [requestPath, requestHash] = process.argv.slice(2);
const request = readBoundJson(requestPath, requestHash);
process.umask(0o022);
requireFact(process.send && request.schema === 1 && request.rootGoSha256 && request.recipeSha256, 'WORKER_BOOT');
for (const root of request.activeRoots) assertTree(root.root, root.manifest);
requireFact(request.activeRoots.some(root => inside(root.root, request.workerModule)), 'UNSEALED_WORKER_MODULE');
let sent = 0;
let received = 0;
const waiting = new Map();
process.on('message', message => {
  try {
    keys(message, ['schema', 'nonce', 'jobId', 'seq', 'type', 'payload']);
    requireFact(message.schema === 1 && message.nonce === request.nonce && message.jobId === request.job.id && message.seq === received++ && message.type === 'REPLY', 'WORKER_IPC_REPLY');
    const waiter = waiting.get(message.payload.requestSeq);
    requireFact(waiter, 'UNKNOWN_REPLY');
    waiting.delete(message.payload.requestSeq);
    if (message.payload.error) waiter.reject(Object.assign(new Error(message.payload.error.message), message.payload.error));
    else waiter.resolve(message.payload.value);
  } catch (error) { for (const waiter of waiting.values()) waiter.reject(error); waiting.clear(); process.exitCode = 1; process.disconnect(); }
});
const rpc = (type, payload) => new Promise((resolve, reject) => {
  const seq = sent++;
  const message = { schema: 1, nonce: request.nonce, jobId: request.job.id, seq, type, payload };
  requireFact(seq < 2048 && Buffer.byteLength(JSON.stringify(message)) <= 262144, 'WORKER_IPC_BOUND');
  waiting.set(seq, { resolve, reject });
  process.send(message, error => { if (error) { waiting.delete(seq); reject(error); } });
});
const api = createWorkerApi(request, rpc);
try {
  if (!['types', 'loaded'].includes(request.workerRole)) await api.phase('setup', { workerStartup: 'Parent launch-to-this-event includes Node and trusted harness startup' });
  const namespace = await import(pathToFileURL(request.workerModule).href);
  requireFact(typeof namespace.runWorker === 'function', 'WORKER_EXPORT');
  const result = await namespace.runWorker(api);
  requireFact(result && ['PASS', 'FAIL', 'UNRUN', 'INCOMPLETE'].includes(result.status) && typeof result.proofRole === 'string', 'WORKER_RESULT');
  await api.finishPhases();
  await api.guard();
  await rpc('RESULT', { schema: 1, jobId: request.job.id, environment: request.job.environment ?? null, role: result.proofRole, status: result.status, details: result.details ?? {}, artifacts: result.artifacts ?? [], stageOutput: result.stageOutput ?? null, rootGoSha256: request.rootGoSha256, recipeSha256: request.recipeSha256 });
} catch (error) {
  try { await rpc('FATAL', describeError(error)); } catch {}
  process.exitCode = 1;
} finally { if (process.connected) process.disconnect(); }
