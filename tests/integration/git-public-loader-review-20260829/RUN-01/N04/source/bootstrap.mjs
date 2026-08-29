import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import workers, { isMainThread } from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { admitWorker } from './worker-policy.mjs';
const manifest = JSON.parse(fs.readFileSync(process.env.FIXTURE_MANIFEST, 'utf8'));
const emit = record => fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(record) + '\n');
assert.equal(isMainThread, true);
const permitted = new Set(['P04', 'P05', 'P06', 'P08', 'P09']).has(process.env.CASE_ID);
const entry = manifest.applicationEntry;
const NativeWorker = workers.Worker;
let created = 0, live = 0;
workers.Worker = class extends NativeWorker {
  constructor(filename, options) {
    const requested = filename instanceof URL ? fileURLToPath(filename) : filename;
    admitWorker(requested, entry, options, created, live, permitted ? 1 : 0);
    const row = manifest.files.find(item => item.path === entry), metadata = fs.lstatSync(entry);
    assert.ok(row && metadata.isFile() && !metadata.isSymbolicLink()); assert.equal(fs.realpathSync(entry), entry);
    const bytes = fs.readFileSync(entry); assert.equal(bytes.length, row.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256);
    super(filename, { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } });
    const id = ++created; live++;
    this.once('exit', code => { live--; try { emit({ kind: 'application-exit', id, code, live }); } catch { process.exitCode = 78; } });
    try { emit({ kind: 'application-create', id, threadId: this.threadId, entry }); } catch (error) { process.exitCode = 78; void this.terminate().catch(() => { process.exitCode = 78; }); throw error; }
  }
};
syncBuiltinESMExports();
globalThis.loaderReview = Object.freeze({ snapshot: () => Object.freeze({ created, live, ready: true }) });
emit({ kind: 'bootstrap', isMainThread, permitted });
process.once('beforeExit', () => { emit({ kind: 'before-exit', created, live }); if (live) process.exitCode = 78; });
if (process.env.CASE_ID === 'P07') throw Error('BOOTSTRAP_SENTINEL');
