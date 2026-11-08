import { readFile, lstat, readdir, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const own = dirname(fileURLToPath(import.meta.url));
const output = join(own, 'DATA-SYNTHESIS.json');
const outer = join(own, 'DATA-SYNTHESIS.outer.jsonl');
await writeFile(outer, JSON.stringify({ event: 'start', date: new Date().toISOString(), productExecution: false }) + '\n', { flag: 'wx' });
async function hash(location) {
  const stat = await lstat(location);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 128 * 1024 * 1024);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(location, { highWaterMark: 65536 })) digest.update(chunk);
  return { path: location, size: stat.size, mode: stat.mode & 0o777, sha256: digest.digest('hex') };
}
const seal = JSON.parse(await readFile(join(own, 'SEAL-v3.json'), 'utf8'));
for (const row of [seal.node, ...seal.sources, ...seal.inputs, ...seal.tools]) assert.deepEqual(await hash(row.path), row);
const attempts = [];
for (const label of ['ACTUAL-02', 'ACTUAL-03']) {
  const value = JSON.parse(await readFile(join(own, label, 'RESULT.json'), 'utf8'));
  const baseline = Object.fromEntries(value.emittedBinding.filter(entry => entry.path.endsWith('.js')).map(entry => [basename(entry.path, '.js'), entry.sha256]));
  const roles = [];
  for (const row of value.rows) {
    const differences = Object.entries(row.loads.files).filter(([name, file]) => file.sha256 !== baseline[name]).map(([name]) => name);
    assert.equal(differences.length, row.expectedFailure ? 1 : 0, `exact loaded mutation count ${row.role}`);
    assert.equal(row.loads.execPath, seal.node.path);
    assert.equal(row.exitCode, row.results.fail ? 1 : 0);
    roles.push({ role: row.role, pass: row.results.pass, fail: row.results.fail, expectedFailure: row.expectedFailure, differences });
  }
  for (const entry of value.census) assert.deepEqual(await hash(entry.path), entry);
  const artifact = value.census.filter(entry => entry.path.includes('/physically-moved-app/artifact/'));
  assert.equal(artifact.length, value.emittedBinding.length);
  for (const entry of artifact) {
    const expected = value.emittedBinding.find(original => basename(original.path) === basename(entry.path));
    assert.ok(expected); assert.equal(entry.sha256, expected.sha256); assert.equal(entry.size, expected.size); assert.equal(entry.mode, expected.mode);
  }
  await assert.rejects(lstat(join(own, label, 'work/installed-app')), error => error.code === 'ENOENT');
  const captures = [];
  for (const name of (await readdir(join(own, label))).sort()) {
    if (name.endsWith('.stdout') || name.endsWith('.stderr') || name === 'outer.jsonl' || name === 'RESULT.json') captures.push(await hash(join(own, label, name)));
  }
  attempts.push({ label, roles, types: value.types, mutants: value.mutantResults, children: value.knownChildren, peakChildren: value.peak, active: value.active, captureBytes: value.captureBytes, workBytes: value.workBytes, elapsedMs: value.elapsedMs, captures, emittedBinding: value.emittedBinding });
}
const sourceProjection = seal.sources.map(row => ({ path: basename(row.path), size: row.size, mode: row.mode, sha256: row.sha256 })).sort((left, right) => left.path < right.path ? -1 : 1);
const result = { createdAt: new Date().toISOString(), sourceProjection, sourceProjectionSha256: createHash('sha256').update(JSON.stringify(sourceProjection)).digest('hex'), sealSha256: (await hash(join(own, 'SEAL-v3.json'))).sha256, node: seal.node, attempts, allExecutionChildren: 53, allExecutionChildrenRetired: 53, originalCompilerFailure: { label: 'ACTUAL-01', children: 1, code: 2, bytes: 491 }, foreignChanges: 'not touched; publication uses explicit owned paths only', native: 'UNRUN', worker: 'UNRUN', shellIntegration: 'UNRUN' };
await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
await writeFile(outer, JSON.stringify({ event: 'complete', output: await hash(output), attempts: attempts.map(value => ({ label: value.label, children: value.children, elapsedMs: value.elapsedMs, captureBytes: value.captureBytes, workBytes: value.workBytes })), sourceProjectionSha256: result.sourceProjectionSha256, sealSha256: result.sealSha256 }) + '\n', { flag: 'a' });
console.log(JSON.stringify({ sourceProjectionSha256: result.sourceProjectionSha256, sealSha256: result.sealSha256, sourceProjection, attempts: attempts.map(value => ({ label: value.label, roles: value.roles.slice(0, 3), children: value.children, elapsedMs: value.elapsedMs, captureBytes: value.captureBytes, workBytes: value.workBytes })) }, null, 2));
