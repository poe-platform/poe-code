import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { gunzipSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { HERE, REPO, sha, objectHash, need, now, put, untar } from './common.mjs';
import { makeCases } from './cases.mjs';

const binding = JSON.parse(await fs.readFile(path.join(HERE, 'BINDING.json')));
const rows = binding.selected;
const raw = execFileSync('/usr/bin/git', ['cat-file', '--batch'], { cwd: REPO, input: rows.map(row => row.blob).join('\n') + '\n', timeout: 15000, maxBuffer: 16 * 1024 * 1024, env: { PATH: '/usr/bin:/bin', GIT_OPTIONAL_LOCKS: '0' } });
let offset = 0;
const payload = rows.map(row => {
  const newline = raw.indexOf(10, offset); need(raw.subarray(offset, newline).toString() === `${row.blob} blob ${row.bytes}`, 'batch stored blob header');
  offset = newline + 1; const bytes = raw.subarray(offset, offset + row.bytes); offset += row.bytes + 1;
  need(sha(bytes) === row.sha256 && objectHash('blob', bytes) === row.blob, 'batch blob hashes');
  return { path: row.path, mode: typeof row.mode === 'number' ? row.mode : Number.parseInt(row.mode, 8) & 0o777, sha256: row.sha256, base64: bytes.toString('base64') };
});
need(offset === raw.length, 'batch complete');
await put(path.join(HERE, 'INPUTS.json'), JSON.stringify(payload) + '\n');
const packagePath = path.join(REPO, 'tests/commands/git-author-20260828/results-v1/PACKAGE.tgz.base64');
const packageBytes = Buffer.from((await fs.readFile(packagePath)).toString().trim(), 'base64');
need(sha(packageBytes) === binding.packageSha256, 'sealed actual package bytes');
const members = untar(gunzipSync(packageBytes, { maxOutputLength: 32 * 1024 * 1024 }));
const mutants = [
  { id: 'wrong-raw', file: 'dist/commands/git/queries.js', needle: 'await session.output(content.bytes);', replacement: 'await session.output(Buffer.from("independent-mutant"));', cases: ['A04'] },
  { id: 'guessed-mode', file: 'dist/commands/git/repository.js', needle: 'this.session.context.fs.capabilities.permissions === true', replacement: 'true', cases: ['H06'] },
  { id: 'unmerged-diff', file: 'dist/commands/git/queries.js', needle: '!index.some(entry => entry.stage && selected(entry.path, specs))', replacement: 'true', cases: ['A26'] },
].map(mutant => {
  const original = members.find(row => row.path === mutant.file).data.toString();
  need(original.split(mutant.needle).length === 2, 'one actual emitted mutant discriminant');
  const text = `globalThis.__reviewMutant = ${JSON.stringify(mutant.id)};\n` + original.replace(mutant.needle, mutant.replacement);
  return { ...mutant, originalSha256: sha(original), mutatedSha256: sha(text) };
});
const names = ['common.mjs', 'prepare.mjs', 'freeze.mjs', 'fixtures.mjs', 'cases.mjs', 'loader.mjs', 'child.mjs', 'worker.mjs', 'supervisor.mjs', 'run.mjs', 'RECIPE.md', 'BINDING.json', 'INPUTS.json'];
const files = [];
for (const name of names) { const bytes = await fs.readFile(path.join(HERE, name)); files.push({ path: name, bytes: bytes.length, sha256: sha(bytes) }); }
const flag = await fs.readFile('/tmp/safe-bash-git-native-bridge-prep-result.txt');
const records = JSON.parse(await fs.readFile(binding.records.path));
let objects = 0, commits = 0;
for (const row of records.files.filter(row => row.path.startsWith('.git/objects/'))) {
  const bytes = inflateSync(Buffer.from(row.base64, 'base64'), { maxOutputLength: 65536 });
  const zero = bytes.indexOf(0), header = bytes.subarray(0, zero).toString().split(' ');
  need(Number(header[1]) === bytes.length - zero - 1, 'neutral object body framing');
  need(createHash('sha1').update(bytes).digest('hex') === row.path.slice(13).replace('/', ''), 'neutral object filename authentication');
  objects++; if (header[0] === 'commit') commits++;
}
const index = Buffer.from(records.files.find(row => row.path === '.git/index').base64, 'base64');
need(objects === 11 && commits === 2 && index.length === 184 && index.subarray(0, 4).toString() === 'DIRC' && index.readUInt32BE(4) === 2 && createHash('sha1').update(index.subarray(0, -20)).digest().equals(index.subarray(-20)), 'neutral11/two/184 crypto authentication only');
const suite = makeCases(null).map(({ id, title }) => ({ id, title }));
need(suite.length === 71 && new Set(suite.map(row => row.id)).size === 71, 'exact71 row cohort');
const invocationCounts = [1,1,1,1,1,1,4,2,1,3,3,3,4,8,5,3,4,4,3,5,1,3,3,4,3,14,4,3,6,5,1,2,2,1,2,3,2,1,1,2,3,2,2,4,2,1,6,5,3,2,2,0,2,1,4,3,1,2,1,1,1,1,1,1,2,1,2,0,1,1,1];
need(invocationCounts.length === suite.length, 'all exact planned invocation counts');
for (const [position, row] of suite.entries()) row.plannedInvocations = invocationCounts[position];
const seal = { schema: 'different-m1a-review-v5-preseal', source: binding.source, evidence: binding.evidence, base: binding.base,
  frozenAt: new Date().toISOString(), frozenMonotonicMs: now(), preparationElapsedMs: now() - binding.startMonotonicMs,
  nativePrepClosed: { flag: '/tmp/safe-bash-git-native-bridge-prep-result.txt', sha256: sha(flag), exists: true, authorizesNothingAdditional: true },
  files, cases: suite, mutants, packagePath, packageSha256: binding.packageSha256,
  plans: { rowsPerLayout: 71, commandInvocationsPerLayoutIfNoEarlierAssertionFails: invocationCounts.reduce((total, count) => total + count, 0), layouts: ['source', 'compiled', 'manual-staged', 'physically-moved'], rowExecutions: 284, build: 1, typeChildren: 5, strictPositive: 1, unsuppressedNegative: 4, loadedMutantChildren: 3, bindingRefusalChildren: 3, controlChildren: 1, totalChildren: 17, maxConcurrentOwnedProcesses: 4, targetProcesses: 2, nativeGit: 0, nativeH11: 0, M1B: 0 },
  workerGeometry: { working: path.join(HERE, 'working-v1'), capture: path.join(HERE, 'capture-v1'), app: 'working-v1/app/node_modules/virtual-bash', moved: 'working-v1/moved app/node_modules/virtual-bash', originalAppMustBeAbsentBeforeMoved: true },
};
await put(path.join(HERE, 'PRESEAL.json'), JSON.stringify(seal, null, 2) + '\n');
console.log(JSON.stringify({ schema: seal.schema, files: files.length, cases: suite.length, children: 17, preparationElapsedMs: seal.preparationElapsedMs, nativePrepClosed: true }));
