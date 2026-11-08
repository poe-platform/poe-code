import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { guardState } from './guard.mjs';

const root = process.env.SURFACE_ROOT;
const id = process.env.PROBE_ID;
assert(['G1', 'G2'].includes(id));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = readFileSync(join(root, 'consumer/harness', `${id}.guest.txt`), 'utf8');
const report = { id, pid: process.pid, sourceSHA256: hash(source), runtimeCalls: 0, bridgeCalls: [], builtinEntries: [], disposed: 0, engine: null, passed: false };
let activeBridge = null;
globalThis[Symbol.for('virtual-bash.getopts.followup.witness')] = state => {
  assert(activeBridge, 'Actual builtin must run during the guest-invoked bridge');
  report.builtinEntries.push({ bridge: activeBridge.index, scriptSHA256: activeBridge.scriptSHA256, ...state });
};
let outer;
let inner;
try {
  const product = await import('virtual-bash');
  const { run } = await import(pathToFileURL(join(root, 'engine/src/run.ts')).href);
  const { Budget } = await import(pathToFileURL(join(root, 'engine/src/interp/budget.ts')).href);
  const { makeFsModule } = await import(pathToFileURL(join(root, 'engine/src/modules/fs.ts')).href);
  const { declareHostOperation } = await import(pathToFileURL(join(root, 'engine/src/interp/host-bridge.ts')).href);
  const filesystem = new product.MemoryFileSystem();
  await filesystem.mkdir('/work', { recursive: true });
  const limits = { maxSourceBytes: 65536, maxOutputBytes: 65536, maxCommands: 256, maxLoopIterations: 128 };
  outer = new product.Shell({ fs: filesystem, cwd: '/work', env: { TAG: 'getopts-followup' }, limits });
  inner = new product.Shell({ fs: filesystem, cwd: '/work', env: { TAG: 'bridge-owned-by-host' }, limits });
  const runtime = {
    createBudget: options => new Budget(options), makeFsModule, declareHostOperation,
    async run(actualSource, options) {
      assert.equal(actualSource, source);
      report.runtimeCalls += 1;
      const shellModule = product.makeSafeJsShellModule(async (script, executionOptions) => {
        assert.equal(activeBridge, null);
        const call = { index: report.bridgeCalls.length, script, scriptSHA256: hash(script) };
        report.bridgeCalls.push(call);
        activeBridge = call;
        try { const result = await inner.exec(script, executionOptions); call.result = result; return result; }
        finally { activeBridge = null; }
      }, { fs: filesystem, signal: options.signal, replayPolicy: 'read-side-effect', declareHostOperation });
      const result = await run(actualSource, { ...options, modules: { ...options.modules, shell: shellModule } });
      report.engine = result.ok ? { ok: true, returnValue: result.returnValue } : { ok: false, error: String(result.error), stack: result.error?.stack };
      return result;
    },
  };
  outer.use(product.safeJsCommands({ runtime, limits: { maxSourceBytes: 65536, maxInputBytes: 4096, maxOutputBytes: 65536, timeoutMs: 2000, maxSteps: 20000, maxCallDepth: 64, stringLength: 65536, arrayLength: 4096, dataSize: 1048576 } }));
  await filesystem.writeFile('/work/probe.js', Buffer.from(source));
  report.outer = await outer.exec(`OPTIND=7; OPTERR=0; OPTARG=parent; set -- parent sentinel; safejs /work/probe.js; status=$?; printf 'OUTER|%s|%s|%s|%s|%s|%s|%s\\n' "$status" "$OPTIND" "$OPTERR" "$OPTARG" "$#" "$1" "$2"`);
  assert.equal(report.outer.exitCode, 0);
  assert.equal(report.outer.stderr, '');
  assert.equal(report.outer.stdout, 'OUTER|0|7|0|parent|2|parent|sentinel\n');
  assert.equal(report.runtimeCalls, 1);
  assert.equal(report.engine.ok, true);
  assert.equal(report.engine.returnValue.marker, `${id}_GUEST_ASSERTIONS_COMPLETE`);
  assert.equal(report.engine.returnValue.assertions, id === 'G1' ? 4 : 7);
  assert.equal(report.bridgeCalls.length, id === 'G1' ? 1 : 2);
  assert.equal(report.builtinEntries.length, id === 'G1' ? 4 : 5);
  report.passed = true;
} catch (error) {
  report.failure = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  for (const shell of [inner, outer]) if (shell) { await shell.dispose(); report.disposed += 1; }
  report.guard = guardState();
  if (report.guard.failures.length || report.guard.activeTimers !== 0) { report.passed = false; process.exitCode = 1; }
  delete globalThis[Symbol.for('virtual-bash.getopts.followup.witness')];
  report.finished = new Date().toISOString();
  writeFileSync(process.env.PROBE_RESULT, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
