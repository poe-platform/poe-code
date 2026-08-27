import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { owned, root, sha256, transport } from './support.mjs';
import { blob, candidateCommit, sourceCommit, testRoots } from './acceptance-audit.mjs';
import { safePluginTuple } from './review-checks.mjs';

const read = async name => JSON.parse(await readFile(resolve(owned, name)));
const evidence = await read('acceptance-execution.json');
const input = await read('acceptance-input-audit.json');
const endpoint = await read('acceptance-endpoint-audit.json');
const global = await read('acceptance-live-global.json');
test('frozen reviewer, author preparation, candidate and endpoint identities agree', async () => {
  assert.deepEqual(input.proof, endpoint.proof);
  for (const [path, proof] of Object.entries(input.proof)) {
    assert.equal(sha256(await readFile(resolve(root, path))), proof.sha256, path);
    assert.equal(sha256(blob(proof.commit, path)), proof.sha256, path);
  }
  assert.equal(input.original27.length, 27);
  assert.equal(input.original27.filter(row => row.classification === 'registered-command-label').length, 2);
  assert.equal(input.comparisonCount, 176);
  assert.ok(input.comparisons.every(row => row.rawTupleEqual));
});
test('one complete canonical183 and separate strict historical52 retain exact counts and names', () => {
  const canonical = evidence.runs.find(row => row.label === 'canonical-four');
  const historical = evidence.runs.find(row => row.label === 'strict-historical');
  assert.deepEqual(canonical.counts, { tests: 183, pass: 183, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  assert.equal(canonical.result.status, 0);
  assert.deepEqual(historical.counts, { tests: 52, pass: 36, fail: 16, cancelled: 0, skipped: 0, todo: 0 });
  assert.equal(historical.result.status, 1);
  const failures = [...Buffer.from(historical.result.stdout, 'base64').toString().matchAll(/^not ok \d+ - (.+)$/gmu)].map(match => match[1]);
  assert.deepEqual(failures, input.original27.filter(row => row.classification === 'historical-bash32-profile').map(row => row.name));
  const names = [...Buffer.from(canonical.result.stdout, 'base64').toString().matchAll(/^ok \d+ - (.+)$/gmu)].map(match => match[1]);
  assert.equal(names.filter(name => name.startsWith('GNU-5.3/')).length, 52);
  assert.equal(names.filter(name => name.startsWith('GNU5.3 declared-profile differential:')).length, 72);
  assert.equal(names.filter(name => name.startsWith('GNU5.3 declared-profile parse-before-effects:')).length, 5);
  assert.equal(names.filter(name => name.startsWith('remaining-gap ')).length, 11);
  assert.equal(names.filter(name => name.startsWith('closure ')).length, 34);
});
test('all actual archive imports match before/load/after identities and committed full source', () => {
  assert.equal(evidence.sourceCommit, sourceCommit);
  assert.equal(Object.keys(evidence.committed).length, 177);
  assert.equal(Object.keys(evidence.committed).filter(path => path.startsWith('src/')).length, 173);
  assert.equal(evidence.failure, null);
  assert.ok(evidence.sourceAndInputsRestored && evidence.toolsStable);
  for (const row of evidence.runs) {
    assert.ok(transport(row.result)); assert.ok(row.guard.valid);
    assert.deepEqual(evidence.manifests[row.before], evidence.manifests[row.after]);
    for (const load of evidence.manifests[row.loads]) {
      assert.ok(load.valid);
      assert.equal(load.hash, load.before);
      assert.equal(load.hash, load.expected);
      if (load.path.startsWith(evidence.archive + '/src/')) assert.equal(load.hash, evidence.committed[load.path.slice(evidence.archive.length + 1)].sha256);
    }
  }
  for (const [path, proof] of Object.entries(evidence.committed)) assert.equal(sha256(blob(sourceCommit, path)), proof.sha256);
  assert.equal(evidence.runs[0].guard.publicIndexLoads, 88);
});
test('actual candidate assertions reject twelve named laboratory mutants, with two positives', () => {
  const mutants = evidence.runs.filter(row => row.label.startsWith('mutant-'));
  const positives = evidence.runs.filter(row => row.label.startsWith('positive-'));
  assert.equal(mutants.length, 12); assert.equal(positives.length, 2);
  for (const row of mutants) {
    assert.equal(row.result.status, 1); assert.equal(row.counts.fail, 1);
    assert.notEqual(row.mutation.originalSha256, row.mutation.mutatedSha256);
    assert.equal(sha256(row.mutation.originalText), row.mutation.originalSha256);
    assert.equal(sha256(row.mutation.mutatedText), row.mutation.mutatedSha256);
    assert.ok(row.args.some(arg => arg.startsWith('--test-name-pattern=')));
    assert.match(Buffer.from(row.result.stdout, 'base64').toString(), /AssertionError|ERR_ASSERTION/u);
  }
  for (const row of positives) assert.deepEqual(row.counts, { tests: 1, pass: 1, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
});
test('safeplugin expectations equal independently frozen truthful tuples, not builtin rewrites', () => {
  const text = blob(candidateCommit, testRoots[3]).toString();
  const tuples = [...text.matchAll(/\["(query-V-verbose|type-multiple-status)", \{ exitCode: 0, stdoutHex: Buffer\.from\(("(?:\\.|[^"\\])*")\)\.toString\("hex"\), stderrHex: "" \}\]/gu)];
  assert.equal(tuples.length, 2);
  for (const match of tuples) {
    const expected = safePluginTuple(`closure/${match[1]}`, '/work');
    assert.deepEqual({ stdout: Buffer.from(JSON.parse(match[2])).toString('base64'), stderr: '', status: 0 }, expected);
  }
  assert.deepEqual(blob(candidateCommit, 'tests/shell-stress/invocation-closure/native-preparation.json'), blob(sourceCommit, 'tests/shell-stress/invocation-closure/native-preparation.json'));
});
test('scoped compiler and one live global compiler preserve their separate measured scopes', () => {
  const scoped = evidence.runs.find(row => row.label === 'scoped-types').compiler;
  assert.equal(scoped.roots.length, 7); assert.equal(scoped.reads.length, 331);
  assert.equal(scoped.diagnostics.length, 0); assert.ok(scoped.guardValid);
  assert.equal(global.result.status, 0); assert.equal(global.compiler.diagnostics.length, 0);
  assert.equal(global.compiler.roots.length, 2697); assert.equal(global.compiler.reads.length, 2885);
  assert.ok(global.compiler.guardValid);
  assert.equal(global.before.head, global.after.head);
  for (const record of [...scoped.reads, ...global.compiler.reads]) {
    assert.equal(record.before, record.read); assert.equal(record.before, record.afterRead); assert.equal(record.before, record.after);
  }
});
test('durable cleanup proof binds raw execution and no historical evidence was overwritten', async () => {
  const cleanup = await read('acceptance-cleanup.json');
  assert.equal(cleanup.rawSha256, sha256(await readFile(resolve(owned, 'acceptance-execution.json'))));
  assert.ok(cleanup.directoryRemoved && cleanup.allOwnedGroupsAbsent);
  assert.equal(global.result.groupAlive, false);
  const old = await read('aligned-freeze.json');
  for (const [name, hash] of Object.entries(old.files)) assert.equal(sha256(await readFile(resolve(owned, name))), hash);
});
