import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { owned, product, base, quota, nearby, frozen, hash, git, save, put, replaceOne } from './lib.mjs';

const output = join(owned, process.argv[2]);
const author = join(owned, '../author');
const manifest = JSON.parse(readFileSync(join(author, 'MANIFEST.json')));
assert.equal(manifest.candidate, product);
assert.equal(manifest.canonicalCommit, '860967af44b20918e3096230f6c7445d4c9cf133');
assert.equal(git('diff-tree', '--no-commit-id', '--name-only', '-r', manifest.canonicalCommit).toString().trim(), 'tests/commands/expr/contracts.test.ts');
put(join(output, 'author-receipt.txt'), readFileSync('/tmp/expr-sink-migration-author-v3-20260827-candidate.txt'));
for (const name of ['MANIFEST.json','FREEZE.json']) put(join(output, 'author', name + '.data'), readFileSync(join(author, name)));
const records = [];
for (const record of manifest.records) {
  const bytes = readFileSync(join(author, record.path));
  assert.equal(hash(bytes), record.sha256, record.path);
  const original = record.originalPath ? frozen(record.originalPath, record.originalCommit) : null;
  if (original) assert.equal(hash(original), record.originalSha256 ?? record.sha256, record.originalPath);
  if (record.byteIdentical) assert.deepEqual(bytes, original);
  if (!original) {
    assert(record.path.endsWith('core-binding-deltas.json'));
    const binding = JSON.parse(bytes), expected = JSON.parse(frozen(`${base}/core-binding-deltas.json`));
    const profile = record.path.includes('/revised-') ? 'revised' : 'original';
    for (const driver of binding.drivers) assert.equal(driver.sha256, hash(readFileSync(join(author, profile, 'core', driver.filename))));
    expected.drivers = binding.drivers;
    expected.assertionsAndInputChanges = binding.assertionsAndInputChanges;
    assert.deepEqual(binding, expected);
  }
  if (record.bindingDeltas) {
    let expected = original.toString();
    for (const [before, after] of record.bindingDeltas) expected = replaceOne(expected, before, after);
    assert.equal(bytes.toString(), expected);
  }
  put(join(output, 'author', record.path + '.data'), bytes);
  records.push({ ...record, independentlyVerified: true });
}
const migrations = [
  { id: 'canonical', old: frozen('tests/commands/expr/contracts.test.ts', product).toString(), next: readFileSync(join(author, 'revised/canonical/contracts.test.ts.data'), 'utf8'), before: 'test("sink failure is status 3 and diagnostic failure is not swallowed", async () => {\n  const result = await run(["1"], {}, { stdout: { async write() { throw new Error("sink failure"); } } });\n  assert.equal(result.exitCode, 3); assert.match(result.stderr, /output failure/u);', after: 'test("sink failure preserves its reason without a diagnostic and diagnostic failure is not swallowed", async () => {\n  const stdoutReason = new Error("sink failure");\n  let diagnosticWrites = 0;\n  await assert.rejects(run(["1"], {}, {\n    stdout: { async write() { throw stdoutReason; } },\n    stderr: { async write() { diagnosticWrites++; } },\n  }), error => error === stdoutReason);\n  assert.equal(diagnosticWrites, 0);' },
  { id: 'core', old: frozen(`${base}/core-drivers/runtime-driver.mjs`).toString(), next: readFileSync(join(author, 'revised/core/runtime-driver.mjs'), 'utf8'), before: "assert.equal(state, 'rejected'); assert.equal(reason, second); assert.deepEqual(writes, ['stdout', 'stderr']);", after: "assert.equal(state, 'rejected'); assert.equal(reason, first); assert.deepEqual(writes, ['stdout']);" },
  { id: 'quota', old: frozen(`${quota}/cases.mjs`).toString(), next: readFileSync(join(author, 'revised/quota/cases.mjs'), 'utf8'), before: "add('stdout-rejection-normal-quota', ['1'], 2, {}, { mode: 'reject-stdout' });", after: "add('stdout-rejection-normal-quota', ['1'], 2, { status: null, stderr: '', rejection: 'sink' }, { mode: 'reject-stdout' });" },
  { id: 'nearby', old: frozen(`${nearby}/freeze/controls.json`).toString(), next: readFileSync(join(author, 'revised/nearby/controls.json'), 'utf8'), before: '"sink": "fail-stdout",\n      "expected": {\n        "exitCode": 3,\n        "stdout": "",\n        "stderr": "expr: execution or output failure\\n"\n      }', after: '"sink": "fail-stdout",\n      "expected": {\n        "rejected": "sink"\n      }' },
];
function auditMigration(specimen, next) { assert.equal(next, replaceOne(specimen.old, specimen.before, specimen.after), `${specimen.id}: exact approved delta only`); }
for (const specimen of migrations) auditMigration(specimen, specimen.next);
assert.equal(migrations[0].next, frozen('tests/commands/expr/contracts.test.ts', manifest.canonicalCommit).toString());
const forbidden = /\bas any\b|@ts-ignore|@ts-nocheck/;
for (const specimen of migrations) assert(!forbidden.test(specimen.after));
const structural = [
  ['changed argv', migrations[1], "direct(['41', '+', '1']", "direct(['42']"],
  ['raised output budget', migrations[2], "['1'], 2, { status: null", "['1'], 3, { status: null"],
  ['changed sink callback', migrations[1], 'return Promise.reject(first)', 'return Promise.resolve()'],
  ['changed job assertion', migrations[3], '"sink": "fail-stdout",\n      "expected": {\n        "rejected": "sink"\n      },\n      "subjects": [\n        "a"\n      ]', '"sink": "fail-stdout",\n      "expected": {\n        "rejected": "sink"\n      },\n      "subjects": []'],
];
const sensitivity = structural.map(([id, specimen, before, after]) => {
  const mutated = specimen.next.replace(before, after); assert.notEqual(mutated, specimen.next, id);
  let caught; try { auditMigration(specimen, mutated); } catch (error) { caught = error; }
  assert.equal(caught?.code, 'ERR_ASSERTION'); assert(caught.message.includes('exact approved delta only'));
  return { id, rejected: true, assertion: `${specimen.id}: exact approved delta only`, positivePassed: true, mutationBefore: before, mutationAfter: after };
});
const cleanupOriginal = frozen(`${nearby}/nearby-driver.mjs`).toString();
const cleanupMutated = replaceOne(cleanupOriginal, "if (record.events.some(event => event.activeWorkers > 0) || workers.size) failures.push('resource work survived settlement/cleanup');", '');
assert.throws(() => assert.equal(cleanupMutated, cleanupOriginal, 'nearby driver cleanup must remain byte-identical'), { code: 'ERR_ASSERTION' });
sensitivity.push({ id: 'removed cleanup assertion', rejected: true, assertion: 'nearby driver cleanup must remain byte-identical', positivePassed: true });
save(join(output, 'audit.json'), { completedAt: new Date().toISOString(), canonicalCommit: manifest.canonicalCommit, records, minimalDeltas: migrations.map(({ id, old, next, before, after }) => ({ id, oldSha256: hash(old), newSha256: hash(next), before, after })), structuralSensitivity: sensitivity, productAndRootChanges: [], bindingOnlySupportDisclosed: records.filter(record => record.bindingDeltas), assertionPlumbingDelta: 'Canonical promotes inline Error to captured identity and adds diagnostic-write counter; exact argv/options and subsequent diagnostic sink assertion preserved. Core assertions only; quota/nearby expected data only; runtime comparator callbacks/jobs/budgets/cleanup unchanged.' });
console.log('Author originals, four minimal migrations, provenance and five structural controls verified.');
