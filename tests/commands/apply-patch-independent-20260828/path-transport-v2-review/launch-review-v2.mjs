import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256, objectId } from './review-reference.mjs';

const own = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(own, '../../../..');
const sealBytes = fs.readFileSync(path.join(own, 'RUNNER-SEAL-V2.json')), seal = JSON.parse(sealBytes);
const presealCommit = process.argv[2], name = process.argv[3];
assert.match(presealCommit ?? '', /^[0-9a-f]{40}$/); assert.match(name ?? '', /^review-[a-z0-9-]+$/);
const destination = path.join(own, name + '.json'), work = path.join(own, '.data-' + name);
assert.equal(fs.existsSync(destination), false); assert.equal(fs.existsSync(work), false);
const started = Date.parse(JSON.parse(fs.readFileSync(path.join(own, 'review-01.json'))).started), children = [];
const environment = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0' };
function child(executable, args, timeout, options = {}) {
  assert.ok(Date.now() - started + timeout < seal.limits.totalMs);
  const begin = Date.now();
  const run = spawnSync(executable, args, { cwd: repository, env: environment, timeout, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, ...options });
  children.push({ executable, args, pid: run.pid, status: run.status, signal: run.signal, error: run.error?.message ?? null, stdoutBytes: run.stdout?.length ?? 0, stdoutSha256: sha256(run.stdout ?? Buffer.alloc(0)), stderrBytes: run.stderr?.length ?? 0, stderrSha256: sha256(run.stderr ?? Buffer.alloc(0)), elapsedMs: Date.now() - begin, timeoutMs: timeout, exactChildReaped: !run.error && run.signal === null, executionModel: 'serial synchronous child, no persistent worker' });
  assert.equal(run.error, undefined); assert.equal(run.signal, null); assert.equal(run.status, 0, run.stderr?.toString());
  return run;
}
function authenticate() {
  let bytesRead = 0, files = 0, directories = 0;
  for (const entry of seal.entries) {
    const filename = path.resolve(repository, entry.path), stat = fs.lstatSync(filename);
    assert.equal(stat.mode & 0o777, entry.mode, entry.path); assert.ok(!stat.isSymbolicLink(), entry.path);
    if (entry.type === 'directory') { assert.ok(stat.isDirectory()); assert.deepEqual(fs.readdirSync(filename).sort(), entry.names); directories++; continue; }
    assert.ok(stat.isFile()); const bytes = fs.readFileSync(filename); bytesRead += bytes.length; files++;
    assert.equal(bytes.length, entry.bytes, entry.path); assert.equal(sha256(bytes), entry.sha256, entry.path); assert.equal(objectId('blob', bytes), entry.blob, entry.path);
  }
  assert.ok(bytesRead < seal.limits.work);
  return { files, directories, cumulativeBytesHashed: bytesRead, entryListSha256: sha256(Buffer.from(JSON.stringify(seal.entries))), directoryAppendChecks: 'Exact recorded directory entry lists, including entire inventory-v1 and tool directories; not an append-proof repository tree.' };
}
const before = authenticate();
const inventory = child('/usr/bin/git', ['--no-replace-objects', 'ls-tree', '-rz', '--full-tree', presealCommit, '--', path.relative(repository, own)], 10000).stdout;
const committed = new Map(inventory.toString('utf8').split('\0').filter(Boolean).map(record => { const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(record); assert.ok(match); return [match[3], match]; }));
for (const name of ['RUNNER-SEAL-V2.json', 'freeze-review-v2.mjs', 'review-reference.mjs', 'run-review-v2.mjs', 'launch-review-v2.mjs', 'prepare-review-v2.mjs', 'REVIEW-RECIPE.md', 'SOURCE-REVIEW.md', 'REVIEW-01-QUALIFICATION.md', ...JSON.parse(fs.readFileSync(path.join(own, 'PRESEAL.json'))).allowedFinalEntries]) {
  const filename = path.join(own, name), match = committed.get(path.relative(repository, filename)); assert.ok(match, name);
  assert.equal(match[2], objectId('blob', fs.readFileSync(filename)), name); assert.equal(match[1], '100644');
}
const run = child(process.execPath, ['--unhandled-rejections=strict', '--max-old-space-size=256', '--permission', `--allow-fs-read=${repository}`, `--allow-fs-write=${work}`, `--allow-fs-write=${work}/*`, path.join(own, 'run-review-v2.mjs'), work], 30000);
const observations = JSON.parse(run.stdout);
const after = authenticate(); assert.deepEqual(after, before); assert.equal(sha256(fs.readFileSync(path.join(own, 'RUNNER-SEAL-V2.json'))), sha256(sealBytes));
let workBytes = 0, workFiles = 0;
function cleanup(directory) {
  for (const name of fs.readdirSync(directory)) {
    const filename = path.join(directory, name), stat = fs.lstatSync(filename); assert.ok(!stat.isSymbolicLink());
    if (stat.isDirectory()) cleanup(filename);
    else { assert.ok(stat.isFile()); workBytes += stat.size; workFiles++; assert.ok(workBytes < seal.limits.work); fs.unlinkSync(filename); }
  }
  fs.rmdirSync(directory);
}
cleanup(work);
const receipt = { schema: 'independent-repair-review-receipt-v1', repairSourceCommit: seal.repairCommit, productSourceCommit: seal.productCommit, productEvidenceCommit: seal.evidenceCommit, runnerPresealCommit: presealCommit, runnerSealSha256: sha256(sealBytes), executionSealSha256: seal.executionSealSha256, started: new Date(started).toISOString(), finished: new Date().toISOString(), elapsedMs: Date.now() - started, before, after, children, cleanup: { exactWorkPath: path.relative(repository, work), absent: !fs.existsSync(work), filesRemoved: workFiles, bytesRemoved: workBytes, authority: 'only unique owned synthetic temporary files', persistentResources: 0 }, budget: { totalMs: seal.limits.totalMs, childTimeoutsMs: [10000,30000], capturedBytes: children.reduce((total, row) => total + row.stdoutBytes + row.stderrBytes, 0), syntheticWorkingBytes: workBytes, byteCeilings: { capture: seal.limits.captures, work: seal.limits.work }, qualification: 'No RSS or global CLI process-peak claim. No product/runtime processes. Tools and all admitted source/data rehashed before/after.' }, observations };
const patch = `*** Begin Patch\n*** Add File: ${path.relative(repository, destination)}\n${JSON.stringify(receipt, null, 2).split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`;
const applied = spawnSync('apply_patch', [], { cwd: repository, input: patch, timeout: 10000, maxBuffer: 1024 * 1024, encoding: 'utf8' }); assert.equal(applied.status, 0, applied.stderr);
console.log(JSON.stringify({ destination: path.relative(repository, destination), counts: observations.counts, dynamic: observations.dynamicDenominator, elapsedMs: receipt.elapsedMs, failures: observations.results.filter(row => row.status === 'FAIL' || row.status === 'UNSUPPORTED').map(row => ({ id: row.id, status: row.status, message: row.error?.message })), facts: observations.facts }));
