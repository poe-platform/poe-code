import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { VERSION, views } from './wire.mjs';
import { createSyncBridge } from './sync-bridge.mjs';

const { session, sab, fixture, sourceSha256, role } = workerData;
if (role !== 'wrq-static-worker-v3' || !parentPort) throw new Error('trusted launch role');
if (fixture === 'L08') {
  const retained = [];
  for (let index = 0; index < 32; index += 1) retained.push(new Array(262144).fill(index));
  parentPort.postMessage({ v: VERSION, session, kind: 'entryReturned', lastSeq: 0, finalFrame: 0, deliveredSeq: 0 });
  parentPort.close();
} else {
  const sourceBytes = readFileSync(new URL('./scaffold.guest.js.data', import.meta.url));
  if (sourceBytes.length > 262144 || createHash('sha256').update(sourceBytes).digest('hex') !== sourceSha256) throw new Error('source preflight');
  const source = sourceBytes.toString('utf8');
  const channel = views(sab, session);
  const transport = createSyncBridge(channel, parentPort);
  const { run, Budget } = await import('@poe-code/safejs/core');
  parentPort.postMessage({ v: VERSION, session, kind: 'ready' });
  let kind = 'entryReturned';
  try {
    const result = await run(source, {
      filename: '/fixture.cjs',
      bindings: { __wrqBridge: transport.bridge, __wrqCase: fixture },
      budget: new Budget({ maxSteps: 100000, maxCallDepth: 128 }),
      sink: { log() { throw new Error('unexpected native console sink'); }, error() { throw new Error('unexpected native console sink'); } }
    });
    if (!result.ok) kind = 'guestFailure';
  } catch { kind = 'guestFailure'; }
  parentPort.postMessage(transport.terminal(kind));
  parentPort.close();
}
