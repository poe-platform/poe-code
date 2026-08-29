import fs from 'node:fs';
import path from 'node:path';
import workerThreads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { admitWorker } from './worker-policy.mjs';
const closure = {"qualification":"STATIC_AUTHENTICATED_IMPORT_INVENTORY_NOT_RUNTIME_TRACE","members":{"dist/commands/regex-execution/worker.js":{"sha256":"46479e6d87bd5d20371a2e523310b2275c74d32d15105fcc9678ec73410efe4f","bytes":1981,"imports":["node:worker_threads","./matching.js","../expr/bre-worker.js","./protocol.js"],"dynamicImportLiteral":false,"requireLiteral":false,"workerConstructorLiteral":false},"dist/commands/regex-execution/protocol.js":{"sha256":"a38e930b62581a22b23d05087b4f67937accbe157d5f6bb6c9b33e7c35f5c9b6","bytes":7869,"imports":[],"dynamicImportLiteral":false,"requireLiteral":false,"workerConstructorLiteral":false},"dist/commands/expr/bre-worker.js":{"sha256":"e744453f4430b6a929cadac4e4b6a8a4e58ac75440ef16006ff4f4dab31f4874","bytes":19153,"imports":["node:worker_threads","../regex-execution/protocol.js"],"dynamicImportLiteral":false,"requireLiteral":false,"workerConstructorLiteral":false},"dist/commands/regex-execution/matching.js":{"sha256":"2f97a68fce0ab504676afe31b4c4fd5eea1edde87ffb28bea9f55c8422693791","bytes":13278,"imports":["node:buffer"],"dynamicImportLiteral":false,"requireLiteral":false,"workerConstructorLiteral":false}},"builtins":["node:buffer","node:worker_threads"],"candidate":"c83f352f057c64917f219eb938f54aa42cdab829","packageSha256":"4671ed60875c87f8cc32b735fde5d9b57301f427ecd5a376ad1123afb951e156"};

const destination = process.env.RESOURCE_LOG;
const allowance = Number(process.env.RESOURCE_ALLOWANCE);
assert.ok(destination && Number.isSafeInteger(allowance) && allowance >= 0 && allowance <= 32);
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
    admitWorker(entry, expected, options, created, live, allowance);
    for (const [relative, member] of Object.entries(closure.members)) {
      const target = path.join(binding.root, relative), metadata = fs.lstatSync(target);
      assert.ok(metadata.isFile() && !metadata.isSymbolicLink()); assert.equal(fs.realpathSync(target), target);
      const data = fs.readFileSync(target); assert.equal(data.length, member.bytes); assert.equal(createHash('sha256').update(data).digest('hex'), member.sha256);
      assert.equal(binding.inputs.find(row => 'dist/' + row.path === relative)?.sha256, member.sha256);
    }
    emit({ kind: 'worker-admit', entry, options });
    super(filename, { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } });
    const id = ++created; live++;
    this.once('exit', code => { live--; try { emit({ kind: 'worker-exit', id, code, live }); } catch { process.exitCode = 78; } });
    try { emit({ kind: 'worker-create', id, threadId: this.threadId, entry, sha256: row.sha256, live }); } catch (error) { process.exitCode = 78; void this.terminate().catch(() => { process.exitCode = 78; }); throw error; }
  }
};
syncBuiltinESMExports();
process.once('beforeExit', () => { emit({ kind: 'before-exit', created, live }); if (live !== 0) process.exitCode = 78; });
