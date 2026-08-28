import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';

const directory = new URL('./', import.meta.url);
const root = new URL('../../../', directory);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const original = JSON.parse(await readFile(new URL('tests/commands/git-author-20260828/results-v1/CANDIDATE.json', root)));
assert.equal(original.sourceCommit, '9885390fb11454fa194a3e60fdbef198dbfdf633');
assert.equal(original.moduleInputs.length, 11);
const currentNames = (await readdir(new URL('src/commands/git/', root))).sort();
assert.deepEqual(currentNames, original.moduleInputs.map(row => row.path.split('/').at(-1)).sort());
for (const row of original.moduleInputs) {
  const location = new URL(row.path, root);
  const metadata = await lstat(location);
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
  const bytes = await readFile(location);
  assert.equal(bytes.length, row.bytes);
  assert.equal(metadata.mode & 0o777, row.mode);
  assert.equal(hash(bytes), row.sha256);
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), row.blob);
}
const declared = JSON.parse(await readFile(new URL('LIMITS.json', directory))).limits;
const source = await readFile(new URL('src/commands/git/limits.ts', root), 'utf8');
const literalLimits = Object.fromEntries([...source.matchAll(/\b(max[A-Za-z]+):\s*(\d+)/g)].map(match => [match[1], Number(match[2])]));
assert.equal(Object.keys(literalLimits).length, 24);
assert.deepEqual(declared, literalLimits);
const inputs = [];
for (const name of (await readdir(directory)).sort()) {
  if (/^BINDING(?:-v\d+)?\.json$/.test(name) || name === 'HANDOFF.md') continue;
  const location = new URL(name, directory);
  const metadata = await lstat(location);
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
  const bytes = await readFile(location);
  inputs.push({ name, bytes: bytes.length, mode: metadata.mode & 0o777, sha256: hash(bytes) });
}
const generation = JSON.parse(await readFile(new URL('GENERATION-v1.json', directory)));
const check = JSON.parse(await readFile(new URL('CHECK-v1.json', directory)));
assert.equal(generation.fixtureSha256, check.fixtureSha256);
assert.equal(inputs.find(row => row.name === 'NEUTRAL-PACKS.json').sha256, check.fixtureSha256);
assert.equal(inputs.find(row => row.name === 'generate-data.mjs').sha256, generation.generatorSha256);
assert.equal(inputs.find(row => row.name === 'check-data.mjs').sha256, check.checkerSha256);
assert.equal(check.productExecutions, 0);
assert.equal(check.nativeGitExecutions, 0);
const runtimeSha256 = hash(await readFile(process.execPath));
assert.equal(runtimeSha256, generation.runtime.sha256);
assert.equal(runtimeSha256, check.runtime.sha256);
console.log(JSON.stringify({
  role: 'M1B_DESIGN_AND_DATA_ONLY', date: '2026-08-28', designPreseal: '7447166d', dataToolsPreseal: 'bacf99cb',
  sourceCommit: original.sourceCommit, sourceInputsUnchanged: original.moduleInputs,
  beforeObservation: 'Eleven live source SHA256 values logged before data generation; development Git diff against9885390f empty before and after. This seal is the post-data source check, not a claimed product loader trace.',
  runtime: { version: process.version, path: process.execPath, sha256: runtimeSha256 },
  fixedLimitValuesMatched: 24, fixtureSha256: check.fixtureSha256,
  evidenceInputs: inputs, productExecutions: 0, nativeGitExecutions: 0,
  builds: 0, installedOrMovedPackageExecutions: 0, implementationGo: false,
  status: 'Different design review and ROOT D1/D2/D3 decisions pending; defaults78 unchanged',
}, null, 2));
