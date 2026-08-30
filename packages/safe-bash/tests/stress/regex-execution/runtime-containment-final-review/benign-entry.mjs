import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundaries, metrics, retired, lateErrors, install } from './observe.mjs';

const [job, packageRoot] = process.argv.slice(2);
assert.equal(job, 'benign');
const entry = import.meta.resolve('virtual-bash');
assert.equal(entry, pathToFileURL(resolve(packageRoot, 'dist/index.js')).href, 'own private package boundary prevents repository self-reference');
const api = await import('virtual-bash');
install(api);
const send = process.send.bind(process);
process.on('uncaughtExceptionMonitor', error => process.stderr.write(`uncaught: ${String(error)}\n`));
process.send = (message, ...args) => {
  if (message?.kind !== 'result') return send(message, ...args);
  void (async () => {
    await new Promise(resolveLate => setTimeout(resolveLate, 50));
    let observerError;
    try {
      for (const boundary of boundaries) {
        const owned = boundary.workers.filter(record => record.owner === boundary.owner);
        retired(owned);
        assert.ok(boundary.signals.every(record => record.listeners === 0), `${boundary.owner} listeners`);
        if (boundary.callerListeners !== null) assert.equal(boundary.callerListeners, 0);
      }
      retired(metrics());
      assert.deepEqual(lateErrors, []);
    } catch (error) { observerError = error.stack; }
    send({ ...message, pass: message.pass && !observerError, observerError, entry, boundaries, finalWorkers: metrics(), lateErrors }, ...args);
  })().catch(error => { process.stderr.write(String(error)); process.exitCode = 1; process.disconnect(); });
  return true;
};
await new Promise((resolveReady, reject) => send({ kind: 'ready', job }, error => error ? reject(error) : resolveReady()));
await new Promise(resolveRun => process.once('message', message => { assert.deepEqual(message, { kind: 'run', job }); resolveRun(); }));
await import('./fixture/runtime.mjs');
