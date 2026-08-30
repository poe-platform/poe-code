import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, createConnection } from 'node:net';
import { Worker } from 'node:worker_threads';

const controls = [];
for (const filename of process.argv.slice(2)) {
  let failure;
  try { readFileSync(filename); } catch (error) { failure = error; }
  assert.equal(failure?.code, 'EPERM', `OS source read must fail: ${filename}`);
  controls.push({ name: 'OS source read denial', filename, code: failure.code });
}
const listening = await new Promise(resolve => {
  const server = createServer();
  server.once('error', error => resolve(error.code));
  server.listen(0, '127.0.0.1', () => server.close(() => resolve('UNEXPECTED_LISTEN')));
});
assert.equal(listening, 'EPERM');
controls.push({ name: 'OS TCP listen denial', code: listening });
const connecting = await new Promise(resolve => {
  const socket = createConnection({ host: '127.0.0.1', port: 9 });
  socket.once('error', error => resolve(error.code));
  socket.once('connect', () => { socket.destroy(); resolve('UNEXPECTED_CONNECT'); });
});
assert.equal(connecting, 'EPERM');
controls.push({ name: 'OS TCP connect denial', code: connecting });
for (const specifier of ['./positive.ts', './external-module.js', 'virtual-bash/src/index.ts']) {
  let failure;
  try { await import(specifier); } catch (error) { failure = error; }
  assert.ok(failure, `unexpected allowed import: ${specifier}`);
  assert.match(failure.message, /SOURCE_FALLBACK_DENIED|EXTERNAL_PRODUCT_MODULE_DENIED|not defined by "exports"/u);
  controls.push({ name: 'module resolution denial', specifier, code: failure.code, message: failure.message });
}
assert.throws(() => new Worker(new URL('./runtime.mjs', import.meta.url)), /PRODUCT_WORKER_ENTRY_DENIED/u);
controls.push({ name: 'unpacked worker denial' });
writeFileSync('isolation-results.json', JSON.stringify(controls, null, 2) + '\n');
console.log(JSON.stringify(controls, null, 2));
