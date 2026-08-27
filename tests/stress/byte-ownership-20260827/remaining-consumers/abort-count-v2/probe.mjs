import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { borrowed, hex } from './fixtures.mjs';
import { vectors } from './vectors.mjs';

const packed = process.argv[2];
assert.ok(packed, 'provide authenticated accepted package root');
const io = `${packed}/dist/contracts/io.js`;
assert.equal(createHash('sha256').update(readFileSync(io)).digest('hex'), '866af6e5a93e9779453d3cc08507a96a94a3f7e82b201048e7ae5fc6203c2c3f');
const { readBytes } = await import(pathToFileURL(io).href);
const controller = new AbortController();
const reason = new Error('remaining-consumers caller abort');
const trace = [];
const snapshot = event => trace.push({ event, aborted: controller.signal.aborted, state: { ...item.state } });
const item = borrowed('Buffer', vectors.raw.chunks, resumed => {
  assert.equal(resumed, 1);
  snapshot('afterRead entered');
  controller.abort(reason);
  snapshot('abort callback returned normally');
});
const source = {
  [Symbol.asyncIterator]() { return this; },
  next() {
    snapshot('next entered');
    const pending = item.source.next();
    pending.then(result => {
      trace.push({ event: 'producer next fulfilled', done: result.done, bytes: hex(result.value), aborted: controller.signal.aborted, state: { ...item.state } });
    });
    return pending;
  },
  return() {
    snapshot('return entered');
    const pending = item.source.return();
    pending.then(() => snapshot('return fulfilled after finally'));
    return pending;
  },
};
const accepted = [];
await assert.rejects(async () => {
  for await (const chunk of readBytes(source, controller.signal)) {
    assert.equal(controller.signal.aborted, false);
    accepted.push(hex(chunk));
    snapshot('readBytes consumer accepted');
  }
}, error => error === reason);
assert.deepEqual(accepted, ['41e2']);
assert.deepEqual(item.state, { yielded: 2, resumed: 1, finalized: true, unchangedChecks: 2 });
assert.equal(trace.filter(entry => entry.event === 'next entered').length, 2);
assert.equal(trace.filter(entry => entry.event === 'return entered').length, 1);
console.log(JSON.stringify({ scope: 'isolated readBytes/producer trace, not the public 24-case replay', accepted, exactReason: true, trace, resources: process.getActiveResourcesInfo() }, null, 2));
