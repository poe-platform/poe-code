import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = path.dirname(fileURLToPath(import.meta.url));
const auth = JSON.parse(readFileSync(path.join(output, 'authentication.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFileSync(path.join(output, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const overlay = path.join(auth.scratch, 'binding-overlay');
mkdirSync(overlay);
for (const filename of ['CONTROLS.json', 'oracle.mjs']) {
  const bytes = readFileSync(path.join(auth.review, filename));
  writeFileSync(path.join(overlay, filename), bytes, { flag: 'wx' });
  assert.equal(hash(readFileSync(path.join(overlay, filename))), hash(bytes));
}
const original = readFileSync(path.join(auth.review, 'run-controls.mjs'), 'utf8');
const replacements = [
  ["import { deriveTree, expectedComparison } from './oracle.mjs';", "import { deriveTree, expectedComparison } from './oracle.mjs';\nimport { bind } from './bind-api.mjs';"],
  ['const api = await import(pathToFileURL(modulePath).href);', 'const api = bind(await import(pathToFileURL(modulePath).href));'],
  ["  if (source.split(mutation.before).length !== 2) {", "  const mutationSource = await readFile(mutation.originalPath, 'utf8');\n  if (mutationSource.split(mutation.before).length !== 2) {"],
  ['  const modified = source.replace(mutation.before, mutation.after);', '  const modified = mutationSource.replace(mutation.before, mutation.after);\n  assert.equal(await readFile(mutation.modifiedPath, \'utf8\'), modified);'],
  ["  const implementation = await import(`data:text/javascript;base64,${Buffer.from(modified).toString('base64')}`);", '  const implementation = bind(await import(pathToFileURL(mutation.modulePath).href));'],
];
let bound = original;
for (const [before, after] of replacements) {
  assert.equal(bound.split(before).length, 2);
  bound = bound.replace(before, after);
}
writeFileSync(path.join(overlay, 'run-controls.mjs'), bound, { flag: 'wx' });
writeFileSync(path.join(overlay, 'bind-api.mjs'), readFileSync(path.join(output, 'bind-api.mjs')), { flag: 'wx' });
save('bound-run-controls.mjs.data', bound);
const diff = spawnSync('git', ['diff', '--no-index', '--', path.join(auth.review, 'run-controls.mjs'), path.join(overlay, 'run-controls.mjs')], { cwd: process.cwd(), timeout: 10000, maxBuffer: 1024 * 1024 });
assert.equal(diff.status, 1);
assert.equal(diff.signal, null);
save('runner-binding.patch.data', diff.stdout);
const controls = JSON.parse(readFileSync(path.join(overlay, 'CONTROLS.json')));
save('binding-audit.json', {
  runnerOriginalSha256: hash(original), runnerBoundSha256: hash(bound), replacements,
  adapterSha256: hash(readFileSync(path.join(output, 'bind-api.mjs'))),
  frozenControlsSha256: hash(readFileSync(path.join(overlay, 'CONTROLS.json'))),
  frozenOracleSha256: hash(readFileSync(path.join(overlay, 'oracle.mjs'))),
  frozenInputsAndExpectedAssertionsUnchanged: true,
  eligibility: { trueOrOmitted: 'LOCAL-TAIL-HYPOTHESIS', false: 'FINITE-PERMISSIVE', noGenericTailApproval: true },
  caseBindings: controls.cases.map(entry => ({ case: entry.id, suppliedPlans: entry.plans.length, eligibility: entry.tail === false ? 'FINITE-PERMISSIVE' : 'LOCAL-TAIL-HYPOTHESIS' })),
  explicitLocalTailControl: 'G2/LOCAL-TAIL-HYPOTHESIS-only retains rejection of P3 tail and acceptance of narrow completed-nonempty',
  dependencyBinding: 'Prepared data-URL mutant loading cannot resolve inherited-model.mjs. Each focused mutant uses its own full two-module file-URL closure; imports must succeed before any kill is considered.',
});
const hooks = [
  { name: 'erase-aggregate', file: 'model.mjs', groups: [1], before: '    return first.start - second.start || second.end - first.end;', after: "    if (first.node.kind === 'repeat') return 0;\n    return first.start - second.start || second.end - first.end;" },
  { name: 'NODE-as-TREE', file: 'model.mjs', groups: [3], before: "    const order = policy === 'HNODE-AGG-v5' ? this.nodeOrder(first, second) : this.treeOrder(first.tree, second.tree);", after: '    const order = this.treeOrder(first.tree, second.tree);' },
  { name: 'skip-clears', file: 'inherited-model.mjs', groups: [4, 5, 6], before: "        event('skip', node.children[0], null, activation, count, position, position);", after: "        if (count === 0 && node.children[0].kind === 'group') update(node.children[0].group, 'absent', undefined, undefined, undefined);\n        event('skip', node.children[0], null, activation, count, position, position);" },
  { name: 'disable-budget', file: 'inherited-model.mjs', groups: [7], before: "    if (work > this.workLimit - this.work || allocation > this.allocationLimit - this.allocation) throw new Refusal('LIMIT');", after: "    if (false) throw new Refusal('LIMIT');" },
  { name: 'swallow-abort-incumbent-fallback', file: 'model.mjs', groups: [8], before: '    return super.rank(histories, policy);', after: '    try { return super.rank(histories, policy); } catch (error) { if (this.meter.signal?.aborted) return histories[0]; throw error; }' },
];
const mutations = [];
const closureInventory = [];
for (const hook of hooks) {
  const directory = path.join(auth.scratch, 'mutants', hook.name);
  mkdirSync(directory, { recursive: true });
  const originalPath = path.join(auth.sealed, hook.file);
  const source = readFileSync(originalPath, 'utf8');
  assert.equal(source.split(hook.before).length, 2, hook.name);
  const modified = source.replace(hook.before, hook.after);
  for (const filename of ['model.mjs', 'inherited-model.mjs']) {
    const bytes = filename === hook.file ? Buffer.from(modified) : readFileSync(path.join(auth.sealed, filename));
    writeFileSync(path.join(directory, filename), bytes, { flag: 'wx' });
    closureInventory.push({ mutant: hook.name, file: filename, sha256: hash(bytes), originalSha256: hash(readFileSync(path.join(auth.sealed, filename))), changed: filename === hook.file });
  }
  const mutation = { ...hook, originalPath, modifiedPath: path.join(directory, hook.file), modulePath: path.join(directory, 'model.mjs'), originalSha256: hash(source), modifiedSha256: hash(modified) };
  mutations.push(mutation);
  save(`mutant-${hook.name}.patch.data`, `--- ${hook.file} (${hash(source)})\n+++ ${hook.file} (${hash(modified)})\n@@ exact unique replacement @@\n-${hook.before.replaceAll('\n', '\n-')}\n+${hook.after.replaceAll('\n', '\n+')}\n`);
}
const binding = { ...JSON.parse(readFileSync(path.join(auth.review, 'BINDING.json'))), status: 'Authenticated binding-only replay; no expectation changes or policy acceptance', candidate: auth.candidate, seal: auth.seal, mutations, eligibilityBinding: { trueOrOmitted: 'LOCAL-TAIL-HYPOTHESIS', false: 'FINITE-PERMISSIVE' } };
const bindingPath = path.join(overlay, 'BINDING.json');
writeFileSync(bindingPath, `${JSON.stringify(binding, null, 2)}\n`, { flag: 'wx' });
save('BINDING.json', binding);
save('mutation-closures-before.json', closureInventory);
const started = new Date().toISOString();
const args = [path.join(overlay, 'run-controls.mjs'), path.join(auth.sealed, 'model.mjs'), bindingPath];
const result = spawnSync(process.execPath, args, { cwd: process.cwd(), timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
save('controls-02-bound.stdout.data', result.stdout ?? Buffer.alloc(0));
save('controls-02-bound.stderr.data', result.stderr ?? Buffer.alloc(0));
save('controls-02-bound.execution.json', { started, ended: new Date().toISOString(), args, node: process.version, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdoutSha256: hash(result.stdout ?? ''), stderrSha256: hash(result.stderr ?? ''), synchronousChildSettled: true });
assert.equal(result.error, undefined);
assert.equal(result.signal, null);
assert.equal(result.stderr.length, 0);
const report = JSON.parse(result.stdout);
assert.equal(report.counts.failed, 0, 'Stop at scoped report on actual baseline defect; no expectation relaxation.');
assert.equal(result.status, 0);
for (const mutant of report.mutants) {
  assert.equal(mutant.status, 'killed');
  assert(mutant.additionalFailures.length > 0);
  assert(!mutant.outcomes.some(entry => entry.id.endsWith('/setup')));
}
for (const entry of closureInventory) assert.equal(hash(readFileSync(path.join(auth.scratch, 'mutants', entry.mutant, entry.file))), entry.sha256);
for (const hook of hooks) {
  const directory = path.join(auth.scratch, 'mutants', hook.name);
  assert.deepEqual(readdirSync(directory).sort(), ['inherited-model.mjs', 'model.mjs']);
  for (const filename of readdirSync(directory)) assert(lstatSync(path.join(directory, filename)).isFile());
}
save('mutation-closures-after.json', { entries: closureInventory, fullDirectoryInventoryAndTypesEqual: true, completeDependencyClosure: true, setupErrorsCountedAsKills: false });
console.log(JSON.stringify({ counts: report.counts, grouped: report.grouped, mutants: report.mutants.map(mutant => ({ name: mutant.name, status: mutant.status, additionalFailures: mutant.additionalFailures.length })) }, null, 2));
const author = JSON.parse(readFileSync(path.join(output, 'author-capture.data')));
writeFileSync('/tmp/expr-v5-final-replay-candidate.txt', `2026-08-27 independent LEAF actual replay; HOLD / NO PROMOTION\nCandidate ${auth.candidate}; source seal ${auth.seal}.\nModel SHA256 ${report.modelSha256}; frozen controls SHA256 ${report.controlsSha256}.\nAuthor ${author.counts.predictionAndControlChecks}/${author.counts.predictionAndControlChecks}, failed checks ${author.counts.failedChecks}; SIX preserved policy targets; verifier exit0 reproduces author exit1, not acceptance.\nPrepared independent controls ${report.counts.passed}/${report.counts.assertions}; mutants ${report.counts.mutantsKilled}/${report.counts.mutantsAttempted}, relevant baseline-passing additional failures only, full inherited dependency included.\nFirst unbound runner 14/95 retained; named eligibility binding only. Capture EEXIST child exit1 retained; first orchestration incorrectly expected2, recovery checks same bytes without rerun.\nEvidence: ${path.relative(process.cwd(), output)}\nCommits/report/final integrity and scratch cleanup pending; no production/public/config/old artifact changes.\n`, { flag: 'wx' });
