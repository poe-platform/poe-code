import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { isMainThread } from 'node:worker_threads';

assert.ok(isMainThread, 'timing preload belongs only to the benchmark child');
const { workers, metrics } = await import('./.temporary/compiled/observe.mjs');
const [packageRoot, baselineRoot] = process.argv.slice(2);
const intervals = [];
const modules = {};
for (const [variant, root] of [['candidate', packageRoot], ['baseline', baselineRoot]]) {
  const entry = pathToFileURL(resolve(root, 'dist/index.js')).href;
  modules[variant] = { entry, physicalEntry: await realpath(fileURLToPath(entry)) };
  const { Shell } = await import(entry);
  const original = { use: Shell.prototype.use, exec: Shell.prototype.exec, dispose: Shell.prototype.dispose };
  const shells = new WeakMap();
  Shell.prototype.use = function (...args) {
    const record = { variant, useStart: performance.now(), firstWorker: workers.length };
    assert.ok(!shells.has(this), 'one plugin registration per benchmark shell');
    shells.set(this, record);
    intervals.push(record);
    const plugin = args[0];
    const setup = plugin.setup;
    assert.equal(typeof setup, 'function');
    plugin.setup = function (...setupArgs) {
      record.pluginSetupStart = performance.now();
      const pending = setup.apply(this, setupArgs);
      if (pending?.then) pending.then(() => { record.pluginSetupEnd = performance.now(); }, error => {
        record.pluginSetupEnd = performance.now(); record.setupRejection = String(error);
      });
      else record.pluginSetupEnd = performance.now();
      return pending;
    };
    try { return original.use.apply(this, args); }
    finally { record.useEnd = performance.now(); }
  };
  Shell.prototype.exec = function (...args) {
    const record = shells.get(this);
    assert.equal(args[0], "rg -g '!file2?.txt' hit .");
    assert.equal(record.execStart, undefined, 'one command per shell');
    record.execStart = performance.now();
    const pending = original.exec.apply(this, args);
    pending.then(() => {
      record.execEnd = performance.now();
      record.publicSettlement = metrics(record.firstWorker);
    }, error => { record.execEnd = performance.now(); record.rejection = String(error); });
    return pending;
  };
  Shell.prototype.dispose = function (...args) {
    const record = shells.get(this);
    assert.equal(record.disposeStart, undefined, 'one explicit dispose per shell');
    record.disposeStart = performance.now();
    const pending = original.dispose.apply(this, args);
    pending.then(() => { record.disposeEnd = performance.now(); }, error => {
      record.disposeEnd = performance.now(); record.disposeRejection = String(error);
    });
    return pending;
  };
}
const send = process.send.bind(process);
process.send = (message, ...args) => {
  if (message.kind === 'result') {
    assert.equal(intervals.length, 6);
    message = { ...message, intervals, modules, timingQualification: 'Additive public-method/plugin-setup timing taps return original values/promises. Setup bound = complete elapsed minus (disposeEnd - execStart); it includes constructor/plugin factory/use and small outer scheduling tails. useEnd-useStart isolates registration, not constructor/factory. Deferred pluginSetupEnd-pluginSetupStart is separately timed inside exec. Timing/settlement observation overhead is included equally; original compiled benchmark and native-worker observer bytes are unchanged.' };
  }
  return send(message, ...args);
};
