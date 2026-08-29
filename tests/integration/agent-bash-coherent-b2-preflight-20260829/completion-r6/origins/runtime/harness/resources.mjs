import fs from 'node:fs';
import path from 'node:path';
import workerThreads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const destination = process.env.RESOURCE_LOG;
const allowance = Number(process.env.RESOURCE_ALLOWANCE);
assert.ok(destination && Number.isSafeInteger(allowance) && allowance >= 0);
const binding = JSON.parse(fs.readFileSync(process.env.PUBLIC_BINDING));
const emit = event => fs.appendFileSync(destination, JSON.stringify(event) + '\n');
const NativeWorker = workerThreads.Worker;
let created = 0, live = 0;
emit({ kind: 'bootstrap', pid: process.pid, allowance });
workerThreads.Worker = class extends NativeWorker {
  constructor(filename, options) {
    assert.ok(created < allowance && live < 2, 'owned worker admission budget');
    const entry = filename instanceof URL ? fileURLToPath(filename) : filename;
    const expected = path.join(binding.root, 'dist/commands/regex-execution/worker.js');
    assert.equal(entry, expected, 'only selected RegexWorker is admitted');
    const metadata = fs.lstatSync(entry); assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
    assert.equal(fs.realpathSync(entry), entry);
    const row = binding.inputs.find(item => item.path === 'commands/regex-execution/worker.js');
    assert.ok(row); assert.equal(createHash('sha256').update(fs.readFileSync(entry)).digest('hex'), row.sha256);
    assert.deepEqual(options.execArgv, []);
    super(filename, options);
    const id = ++created; live++;
    emit({ kind: 'worker-create', id, threadId: this.threadId, entry, sha256: row.sha256, live });
    this.once('exit', code => { live--; emit({ kind: 'worker-exit', id, code, live }); });
  }
};
syncBuiltinESMExports();
process.once('beforeExit', () => { emit({ kind: 'before-exit', created, live }); if (live !== 0) process.exitCode = 78; });
