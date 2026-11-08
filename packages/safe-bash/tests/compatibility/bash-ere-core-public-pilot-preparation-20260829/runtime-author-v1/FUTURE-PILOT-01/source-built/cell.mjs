import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { captureBudget, writer, ledger, describeLedger } from './core.mjs';
import { createObserver } from './observer.mjs';
import { read, hash } from './data.mjs';

const output = writer({ maximum: 65536, aggregate: captureBudget(65536), write: (bytes, offset, count) => fs.writeSync(1, bytes, offset, count) });
const emit = row => output.bytes(Buffer.from(JSON.stringify(row) + '\n'));
const failures = ledger();
let observer;
let id = null;
let result = null;
try {
  emit({ event: 'startup', pid: process.pid, execPath: process.execPath });
  const bytes = read(process.argv[2], 65536);
  assert.equal(hash(bytes), process.argv[3]);
  const spec = JSON.parse(bytes);
  id = spec.id;
  assert.equal(process.execPath, spec.node);
  const require = createRequire(import.meta.url);
  const modulePath = require.resolve('virtual-bash');
  assert.equal(modulePath, spec.modulePath, 'public consumer binding');
  const namespace = require('node:worker_threads');
  observer = createObserver({ NativeWorker: namespace.Worker, expectedUrl: pathToFileURL(spec.workerPath).href, emit });
  namespace.Worker = observer.Constructor;
  syncBuiltinESMExports();
  const api = await import('virtual-bash');
  const shell = new api.Shell({ fs: new api.MemoryFileSystem(), cwd: '/', env: { LC_ALL: 'C', LANG: 'C', TZ: 'UTC' }, limits: spec.limits });
  shell.use(api.agentCommands());
  const actual = await shell.exec(spec.definition.script);
  result = { exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr };
  observer.assertRetired();
  assert.equal(result.exitCode, spec.definition.expected.exitCode);
  assert.equal(result.stdout, spec.definition.expected.stdout);
  assert.equal(result.stderr, spec.definition.expected.stderr.exact);
} catch (reason) { failures.add(reason, 'public-cell'); }
if (observer?.failures.state.present) failures.add(observer.failures.state.reason, 'observer');
try { observer?.assertRetired(); } catch (reason) { failures.add(reason, 'worker-retirement'); }
try { emit({ event: 'final', id, result, workers: observer?.snapshot() ?? [], failure: describeLedger(failures.state) }); } catch (reason) { failures.add(reason, 'final-capture'); }
process.exitCode = failures.state.present ? 1 : 0;
