import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { own, candidate, repository, digest, git } from './audit.mjs';

const read = name => fs.readFileSync(path.join(candidate, name), 'utf8');
const add = (name, value) => {
  const target = path.join(own, name);
  assert(!fs.existsSync(target));
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  execFileSync('apply_patch', [], { cwd: repository, input: `*** Begin Patch\n*** Add File: ${path.relative(repository, target)}\n${text.trimEnd().split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n` });
};
const equal = ['coordinator.mjs', 'synthetic-worker.mjs', 'OPERATION-PLAN.json'].map(name => {
  assert.equal(read(name), read(`../executor-v5/${name}`));
  return { name, sha256: digest(read(name)), equals: `executor-v5/${name}` };
});
const inheritedNames = ['executor-v4/safety.mjs', 'executor-v4/operations.mjs', 'executor-v4/launch-ledger.mjs', 'executor-v4/loaded-outcome.mjs', 'executor-v4/supervisor.mjs', 'executor-v4/controls.mjs', 'executor-v4/adapter.mjs', 'executor-v4/predicates.mjs', 'executor-v3/offline.mjs', 'executor-v3/transport.mjs', 'executor-v3/regular-read.mjs', 'executor-v3/w07.mjs'];
const inherited = inheritedNames.map(name => {
  const filename = path.resolve(candidate, '..', name);
  const relative = path.relative(repository, filename);
  const current = fs.readFileSync(filename);
  assert(current.equals(git(['show', `d40af0d52381a138f2dabb415d343526ad015722:${relative}`])), name);
  return { path: relative, sha256: digest(current), commit: 'd40af0d52381a138f2dabb415d343526ad015722' };
});
const worker = read('worker.mjs');
const normalized = worker.replace(', { entryParentURL: import.meta.url }', '').replace("  requireThat(loader.entryResolutions.length === 1 && loader.entryResolutions[0].accepted === true, 'CONSUMER_ENTRY_REQUIRED', loader.entryResolutions);\n", '').replace(', entryResolutions: loader.entryResolutions, consumerResolutions: loader.consumerResolutions', '');
assert.equal(normalized, read('../executor-v5/worker.mjs'));
assert.equal(read('authorization.mjs').replaceAll(", '../executor-v5'", '').replaceAll(" || prefix === '../executor-v5'", ''), read('../executor-v5/authorization.mjs'));
assert.equal(read('projection.mjs'), "export { boundFile, directories, inspectTree, tarMembers, writeView, viewProjection, authenticateView, parseStage, stage } from '../executor-v5/projection.mjs';\n");
const sequence = ['const permission = authority(', 'const operation = authorizeOperation(', "'CONFIG_OPERATION_PATH'", "'STRICT_UNHANDLED_POLICY'", 'fs.writeFileSync(path.join(permission.context.outputRoot, `operation-', 'authenticateView(projection, config.view)', 'inspectTree(config.view.root, config.view.files)', 'loader = installLoader(config.view, value => writer.emit(value), { entryParentURL: import.meta.url })', 'offline = installOffline(', 'const imported = await import(', "'CONSUMER_ENTRY_REQUIRED'", "'CONSUMER_RESOLUTION_REQUIRED'"];
const offsets = sequence.map(text => {
  const offset = worker.indexOf(text); assert(offset >= 0, text);
  return { text, offset, line: worker.slice(0, offset).split('\n').length };
});
assert(offsets.every((row, index) => index === 0 || row.offset > offsets[index - 1].offset));
let diffs = 'Independent static full differences; not executable guard copies.\n';
for (const name of ['loader.mjs', 'worker.mjs', 'authorization.mjs', 'projection.mjs']) {
  const result = spawnSync('/usr/bin/diff', ['-u', path.join(candidate, '../executor-v5', name), path.join(candidate, name)], { encoding: 'utf8' });
  assert.equal(result.status, 1); diffs += result.stdout;
}
add('BODY-DELTA.txt', diffs);
add('BODY-AUDIT.json', {
  kind: 'STATIC_BODY_REVIEW_NOT_PRODUCTION_AUTHORITY_EXECUTION', date: '2026-08-28', equals: equal, inherited,
  workerDeltaExactly: ['forward literal import.meta.url', 'require one accepted entry resolution', 'retain both entry and bare resolution receipts'],
  staticDraftCorrection: 'Before preseal or any DATA/SYNTHETIC execution, first normalization assertion omitted the newly retained bare-resolution receipt field. Full diff identified the additive diagnostic field; normalization now removes BOTH added receipt fields. No source or expectation execution/retry occurred.',
  authorizationDeltaExactly: 'Protect inherited V5 namespace in the same append-check algorithm. Recipe root is lexical V6 module location. No root grant field or permission expansion.',
  projectionDeltaExactly: 'Re-export unchanged V5 implementation, no new materializer.', productionWorkerOrder: offsets,
  loaderReview: ['Canonical file URL validation rejects absent/query/hash/encoded/other-protocol configured parents; canonicalization identifies aliases, never grants permission.', 'Absolute consumer attempts enforce exact fixed parent and exact specifier before nextResolve; relative intermediate is checked after real nextResolve before load.', 'Resolved consumer entry requires exact specifier, result URL and fixed parent. Bare-library resolution still requires the authenticated consumer parent.', 'Prior membership/metadata/hash/format/returned-source/denied-builtin branches retained. Engine-less fixture loader remains behind authenticated control-worker routing.'],
  roles: 'authority loads committed hashed review before committed hashed grant; different-reviewer/PREEXECUTION_ACCEPTED/recipe and root/phase/recipe/review/attempts=1, pinned candidate/pack, run/output/ordered-command/phase-plan checked before claim/import. No authority invocation in this review.',
  inheritedInterpretation: 'Actual-outcome C12 interpreter, W07 nonexecution/dispatch UNQUALIFIED/UNCREDITED, status/byte/FS predicates, strict transport and offline asset protection remain byte-identical. Historical runtime evidence is inherited, not rerun/expanded. Null/undefined and prepare-EEXIST/tail helpers receive separate fresh synthetic controls.',
  deltaSha256: digest(diffs),
});
const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const names = [...['audit.mjs', 'body-audit.mjs', 'run.mjs', 'worker.mjs', 'data.mjs'].map(name => path.join(own, name)), ...['loader.mjs', 'worker.mjs', 'authorization.mjs', 'projection.mjs', 'entry-worker.mjs', 'entry-controls.mjs'].map(name => path.join(candidate, name))];
const rows = names.map(filename => {
  const result = spawnSync(node, ['--check', filename], { encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
  assert.equal(result.status, 0);
  return { path: path.relative(repository, filename), sha256: digest(fs.readFileSync(filename)), pid: result.pid, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, syntaxOnly: true };
});
add('SYNTAX.json', { node, count: rows.length, rows });
console.log(JSON.stringify({ inherited: inherited.length, syntax: rows.length, staticOnly: true }));
