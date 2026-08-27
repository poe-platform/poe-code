import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rows, hosts } from './corpus.mjs';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../..');
const read = name => readFileSync(resolve(owned, name));
const json = name => JSON.parse(read(name));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const originalSeal = json('seal.json');
const versionedSeal = json('seal-v2.json');
assert.equal(rows.length + hosts.length, 30);
assert.deepEqual(originalSeal.source, versionedSeal.source);
assert.equal(originalSeal.sourceCommit, '6fce94f8716f1b7a8e26af78ef8cb33594ec83cc');
for (const [seal, commit] of [[originalSeal, '5339b1e75ecda072adffed689da21943235b9192'], [versionedSeal, 'dce6e3824d6de6d03490a531cf2bc7d2d279bb8c']]) {
  for (const [name, hash] of Object.entries(seal.inputs)) {
    assert.equal(sha256(read(name)), hash, name);
    const committed = execFileSync('git', ['-C', root, 'show', `${commit}:${relative(root, resolve(owned, name))}`], { maxBuffer: 1024 * 1024 });
    assert.deepEqual(read(name), committed, name);
  }
}
const expectedProduct = read('product.mjs').toString()
  .replace("import { readFileSync } from 'node:fs';", "import { readFileSync, realpathSync } from 'node:fs';")
  .replace("const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));", "const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));\nrequest.dist = realpathSync(request.dist);");
assert.equal(read('product-v2.mjs').toString(), expectedProduct, 'only declared realpath correction');
const reports = [];
for (const [name, sealName, runner] of [['baseline-6fce94f8', 'seal.json', 'run.mjs'], ['baseline-v2-6fce94f8', 'seal-v2.json', 'run-v2.mjs']]) {
  execFileSync(process.execPath, [resolve(owned, runner), 'verify', name], { stdio: 'pipe' });
  const report = json(`${name}/report.json`);
  assert.equal(report.sealSha256, sha256(read(sealName)));
  assert.equal(report.sourceCommit, originalSeal.sourceCommit);
  assert.deepEqual(report.source, originalSeal.source);
  assert.equal(report.processes.length, 76);
  assert.equal(report.counts.timeouts + report.counts.overflows, 0);
  assert.equal(existsSync(report.cleanup.scratch), false);
  assert.ok(report.cleanup.allGroupsAbsent && report.cleanup.scratchRemoved);
  assert.equal(report.records.filter(record => record.kernel && !record.kernel.unavailable).length, 20);
  assert.equal(report.records.filter(record => !record.oracle.unavailable).length, 23);
  reports.push(report);
}
const [first, current] = reports;
assert.equal(first.counts.structured, 0);
assert.equal(current.counts.structured, 30);
assert.equal(current.counts.passed, 7);
assert.equal(current.counts.strictNative, 3);
assert.equal(current.records.reduce((count, record) => count + record.product.parsed.loads.length, 0), 5220);
const nonProving = current.records.find(record => record.id === 'h06');
assert.equal(nonProving.passed, true);
assert.deepEqual(nonProving.product.parsed.observations.map(entry => entry.command), ['./script']);
const qualifiedPasses = current.records.filter(record => record.passed && record !== nonProving).length;
assert.equal(qualifiedPasses, 6);
const aliasRows = current.records.filter(record => record.oracleExpectation && !record.oracleExpectation.fields.stdout);
assert.deepEqual(aliasRows.map(record => record.id), ['s12', 'd04']);
for (const record of aliasRows) assert.equal(Buffer.from(record.oracle.stdout, 'base64').toString(), `/private${record.input.expected.stdout}`);
console.log(JSON.stringify({ sealedCases: 30, observations: 30, rawPasses: 7, qualifiedPasses, failures: 23, nonProving: 1, directControls: 4, strictNative: '3/23', linuxKernelExecuted: false, cleanup: true }));
