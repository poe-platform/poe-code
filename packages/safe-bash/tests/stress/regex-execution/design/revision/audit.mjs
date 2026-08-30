import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { scenarios } from './fixtures.mjs';
const base = new URL('./', import.meta.url); const root = new URL('../../../../../', base);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const build = JSON.parse(readFileSync(new URL('evidence/build.json', base)));
for (const [path, expected] of Object.entries(build.source)) assert.equal(hash(readFileSync(new URL(path, root))), expected, path);
for (const [path, expected] of Object.entries(build.built)) assert.equal(hash(readFileSync(new URL('.temporary/js/' + path, base))), expected, path);
for (const [path, expected] of Object.entries(build.harness)) assert.equal(hash(readFileSync(new URL(path, base))), expected, path);
const hashes = {}; let passes = 0; let workers = 0;
for (const name of scenarios) {
  const result = JSON.parse(readFileSync(new URL(`evidence/${name}.json`, base)));
  assert.equal(result.killed, false); assert.equal(result.code, 0);
  const done = result.messages.find(message => message.type === 'done'); assert(done);
  if (!done.failure) passes++;
  for (const client of done.cleanup) {
    assert.equal(client.metrics.created, client.metrics.terminated);
    assert.equal(client.released, true); assert.equal(client.capacity, 0); assert.equal(client.pending, false);
    assert.equal(client.signalListeners, 0); assert.equal(client.metrics.listenersAfter, 0);
    assert(client.threadId === null || client.threadId === -1);
    workers += client.metrics.created;
  }
  for (const event of ['exit', 'disconnect', 'stdout-close', 'stderr-close', 'close']) assert(result.events.some(entry => entry.event === event));
}
for (const path of readdirSync(new URL('evidence/', base)).sort()) hashes[path] = hash(readFileSync(new URL('evidence/' + path, base)));
const audit = { utc: new Date().toISOString(), children: scenarios.length, passes, failures: scenarios.length - passes, workers, sourceHashes: Object.keys(build.source).length, builtHashes: Object.keys(build.built).length, hashes };
writeFileSync(new URL('evidence/audit.json', base), JSON.stringify(audit, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...audit, hashes: Object.keys(hashes).length }));
