import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('./', import.meta.url)), repository = fileURLToPath(new URL('../../../', import.meta.url));
const fixtureCommit = 'c7f2abab5e11539c69f890e617a461cbd5ec4a08';
const candidate = 'a01310c5571dfda2aae4c6c8cc185e2530a01e89';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const committed = (revision, path) => execFileSync('git', ['--no-replace-objects', 'show', `${revision}:${path}`], { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const walk = (prefix = '') => readdirSync(join(root, prefix)).sort().flatMap(name => { const path = join(prefix, name); assert.equal(lstatSync(join(root, path)).isSymbolicLink(), false); return lstatSync(join(root, path)).isDirectory() ? walk(path) : [path]; });
const manifest = JSON.parse(readFileSync(join(root, 'MANIFEST.json')));
assert.equal(manifest.fixtureCommit, fixtureCommit); assert.equal(manifest.candidate, candidate);
assert.deepEqual(walk().filter(path => path !== 'MANIFEST.json'), manifest.files.map(entry => entry.path));
for (const entry of manifest.files) { const bytes = readFileSync(join(root, entry.path)); assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256, entry.path); }
const owner = 'tests/integration/typecheck-workflow-message-v2-20260827';
for (const path of ['cohort-v2.mjs', 'diagnostic-controls.mjs', 'README.md']) assert.deepEqual(readFileSync(join(root, path)), committed(fixtureCommit, `${owner}/${path}`));
const old = committed('39116ae1da80261d1a55df363f615430eab6609a', 'tests/integration/typecheck-workflow-independent-20260827-closure/unchanged-cohort.mjs').toString();
const current = readFileSync(join(root, 'cohort-v2.mjs'), 'utf8');
const previous = '      assert.match(result.details.result.groups[0].error, /candidate build/u);';
const replacement = "      assert.equal(result.details.result.groups[0].error, `foreign candidate declaration/source fallback: virtual-bash -> ${join(snapshot, 'src/index.ts')}`);";
assert.equal(old.split(previous).length, 2); assert.equal(current, old.replace(previous, replacement));
const changed = old.split('\n').flatMap((line, index) => line === current.split('\n')[index] ? [] : [index + 1]); assert.deepEqual(changed, [248]);
const report = JSON.parse(readFileSync(join(root, 'evidence/cohort/report.json'))), captures = new Map();
assert.equal(report.candidate, candidate); assert.equal(report.harnessSha256, hash(current)); assert.deepEqual(report.counts, { pass: 21, fail: 0, skip: 0 });
assert.equal(report.cleaned, true); assert.equal(report.setupFailure, undefined);
for (const entry of report.captures) { const bytes = gunzipSync(Buffer.from(readFileSync(join(root, 'evidence/cohort', entry.path), 'utf8'), 'base64')); assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256); assert.equal(captures.has(entry.path), false); captures.set(entry.path, bytes); }
const json = name => JSON.parse(captures.get(`${name}.gz.base64`));
assert.deepEqual(json('source-before'), json('source-after'));
const combined = json('combined.report'); assert.equal(combined.status, 'typecheck-passed-not-runtime-acceptance'); assert.equal(combined.builds, 1); assert.equal(combined.phases.length, 28);
assert.equal(combined.sourceConsumers.passed, true); assert.equal(combined.sourceConsumers.groups.length, 3); assert.equal(combined.consumers.passed, true); assert.equal(combined.consumers.groups.length, 19);
assert.deepEqual(combined.consumers.negativeTypes.map(group => group.diagnostics), [1, 2, 5]); assert.equal(combined.runtimeExecutions, 0);
assert.equal(json('source-fallback-negative.report').phases[0].status, 0); assert.equal(json('source-fallback-negative.report').result.passed, false);
assert.equal(report.commands.find(command => command.label === 'source-fallback-negative').status, 2);
assert.equal(report.bindingMutation.status, 2); assert.equal(json('foreign-build-resolution.report').result.passed, false);
for (const command of report.commands) { assert.equal(command.error, undefined); assert.equal(command.signal, null); }
const controls = JSON.parse(readFileSync(join(root, 'evidence/diagnostic-controls.json')));
assert.equal(controls.status, 'pass'); assert.equal(controls.cleaned, true); assert.equal(controls.onlyApprovedStatementChanged, true); assert.equal(controls.fixtureSha256, hash(current));
assert.equal(controls.cases.length, 9); assert.equal(controls.cases.filter(current => current.accept).length, 1);
assert.equal(controls.actualCompilerStatus, 0); assert.equal(controls.actualHelperStatus, 2);
assert.equal(controls.children.find(child => child.name === 'strict-fixture-line').status, 0); assert.equal(controls.children.find(child => child.name === 'unrelated-nonempty-error-mutant').status, 1);
assert.match(controls.children.find(child => child.name === 'unrelated-nonempty-error-mutant').stderr, /Missing expected exception.*unrelated-compiler-diagnostic/u);
console.log(JSON.stringify({ fixtureCommit, candidate, exactChangedLines: changed, cohort: report.counts, diagnosticControls: controls.cases.length, rejectedWeakMutants: 1, authenticatedCaptures: captures.size, original20of21Preserved: true, productConfigurationChanged: false, independentFixtureAcceptance: 'pending root/Curie review' }, null, 2));
