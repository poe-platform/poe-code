import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { regular, put, sha, oid, census } from './common.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../../..'), parent = path.dirname(here), author = path.join(parent, 'observer-qualification-v8');
const precommit = '1f03c93a0a857d7360bf8a418eff45bbcfa20942', evidence = '06265c49d60676f041fed2de07f5a6c8c6c375f5';
const appNames = ['worker.mjs', 'observer.mjs', 'retirement.mjs', 'writer-surrogate.mjs', 'CONTROLS.json', 'SOURCE-DATA.json', 'CORRESPONDENCE.json'];
const documents = ['PRESEAL.json', 'HANDOFF.md', 'WORKER-ADAPTER-PROPOSAL.md', 'CONTINUATION-PROPOSED.json', 'CRITERION.md', 'NODE-PRIMARY.json', 'NODE-PROVENANCE.json'];
const requested = [...appNames.map(name => ({ revision: precommit, path: path.relative(repo, path.join(author, name)) })), ...documents.map(name => ({ revision: evidence, path: path.relative(repo, path.join(author, name)) })), ...['src/commands/git/codec.ts', 'src/contracts/output.ts'].map(filename => ({ revision: '9885390fb11454fa194a3e60fdbef198dbfdf633', path: filename }))];
const metadata = spawnSync('/Library/Developer/CommandLineTools/usr/bin/git', ['cat-file', '--batch'], { cwd: repo, input: requested.map(row => row.revision + ':' + row.path + '\n').join(''), timeout: 30000, maxBuffer: 4 * 1024 * 1024, env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
assert.equal(metadata.status, 0); assert.equal(metadata.signal, null); assert.equal(metadata.error, undefined);
let cursor = 0; const bindings = [];
for (const request of requested) {
  const end = metadata.stdout.indexOf(10, cursor); assert.ok(end > cursor);
  const match = /^([a-f0-9]{40}) blob ([0-9]+)$/u.exec(metadata.stdout.subarray(cursor, end).toString()); assert.ok(match);
  const length = Number(match[2]), bytes = metadata.stdout.subarray(end + 1, end + 1 + length); assert.equal(bytes.length, length); assert.equal(oid(bytes), match[1]); assert.equal(metadata.stdout[end + 1 + length], 10); cursor = end + 2 + length;
  if (request.path.startsWith('tests/')) assert.deepEqual(regular(path.join(repo, request.path)), bytes);
  bindings.push({ ...request, blob: match[1], bytes: length, sha256: sha(bytes) });
}
assert.equal(cursor, metadata.stdout.length);
const source = JSON.parse(regular(path.join(author, 'SOURCE-DATA.json')));
for (const name of ['codec', 'output']) { const bound = bindings.find(row => row.path === source[name].path); assert.equal(sha(Buffer.from(source[name].text)), bound.sha256); assert.equal(source[name].sha256, bound.sha256); }
assert.equal(bindings.find(row => row.path.endsWith('/observer.mjs')).sha256, '30d33df91fe6bfbb89a10ac81b93e39d321bdc7aa39a6133fa2e0dfd65e1f7c1');
assert.equal(bindings.find(row => row.path.endsWith('/retirement.mjs')).sha256, 'c8a19a9389d045b2807eb1d60534747297e2430fd93c7950e1e5025e698720f2');
const oldSeal = JSON.parse(regular(path.join(author, 'PRESEAL.json')));
assert.equal(sha(regular(oldSeal.node.path)), oldSeal.node.sha256);
const helperRoot = path.join(repo, 'tests/shell/indexed-arrays-independent-20260828');
const helperNames = ['s06-successor-v1/preparation-v4/controller.mjs', 's06-successor-v1/preparation-v4/supervisor.mjs', 's06-successor-v1/preparation-v4/deadline.mjs', 's06-successor-v1/preparation-v3/staging.mjs', 'candidate-v1/boundary-app.mjs'];
const prior = JSON.parse(regular(path.join(repo, 'tests/integration/coherent78-arrays-independent-20260828/SEAL.json')));
const role = filename => ({ path: path.relative(repo, filename), bytes: fs.lstatSync(filename).size, mode: fs.lstatSync(filename).mode & 0o777, sha256: sha(regular(filename)) });
const helpers = helperNames.map(name => role(path.join(helperRoot, name)));
for (const helper of helpers) assert.deepEqual(helper, prior.roles.find(row => row.path === helper.path));
const protectedTrees = ['m1a-review-v5', 'observer-qualification-v6', 'observer-qualification-v7', 'observer-qualification-v8'].map(name => ({ root: path.join(parent, name), entries: census(path.join(parent, name)) }));
const policy = { maxConcurrency: 1, totalElapsedMsIncludingCleanup: 600000, reservedCleanupMs: 45000, maxGitChildren: 0, maxOtherSupervisedChildren: 12, maxProductWorkers: 12, maxRuntimeWorkerMs: 60000, maxRuntimeWorkerCaptureBytes: 4 * 1024 * 1024, maxTypeWorkerCaptureBytes: 0, maxToolCaptureBytes: 0, maxGitCaptureBytes: 0, maxTotalCapturedChildBytes: 32 * 1024 * 1024, maxTotalGitBytes: 0, maxWorkingBytes: 128 * 1024 * 1024, maxRecordBytes: 8 * 1024 * 1024, maxPersistedEvidenceBytes: 16 * 1024 * 1024 };
const seal = { kind: 'independent observer-only review', authorPreseal: precommit, authorEvidence: evidence, bindings, node: oldSeal.node, appNames, protectedTrees, roles: [...helpers, ...['common.mjs', 'bootstrap.mjs', 'counter.mjs', 'prepare.mjs', 'run.mjs', 'PRESEAL.md'].map(name => role(path.join(here, name)))], metadata: { children: 1, bytes: metadata.stdout.length, code: metadata.status, candidateExecutions: 0 }, policy, label: 'GIT-OBSERVER-V8-INDEPENDENT-01', childEntries: ['worker.mjs', 'counter.mjs'], expectedOriginal: 19, expectedIndependent: 5, candidateAdmission: false };
const bytes = Buffer.from(JSON.stringify(seal, null, 2) + '\n'); put(path.join(here, 'SEAL.json'), bytes);
console.log(JSON.stringify({ sealSha256: sha(bytes), preparedBindings: bindings.length, candidateExecutions: 0, plannedChildren: 2, originalOuter: 19, independentSynthetic: 5 }));
