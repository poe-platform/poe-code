import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { owned, root, sha256, save } from './support.mjs';
import { inspectTar } from './packed-tar.mjs';
import { nativeCases } from './cases.mjs';

const report = JSON.parse(await readFile(resolve(owned, 'packed-core-84ab66c.json')));
const native = JSON.parse(await readFile(resolve(owned, 'native-frozen.json')));
const tarball = JSON.parse(await readFile(resolve(owned, 'packed-core-84ab66c-tarball.json')));
const bytes = Buffer.from(tarball.data, 'base64'); assert.equal(sha256(bytes), report.tarball.sha256);
const tar = inspectTar(bytes, { compressed: true, prefix: 'package/' });
const packed = Object.fromEntries(Object.entries(tar.files).map(([name, file]) => [name.slice(8), file.sha256]));
assert.deepEqual(packed, report.manifests[report.packedFiles]);
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 64e6 });
const sourceProof = Object.entries(report.manifests[report.sourceBefore]).map(([path, hash]) => ({ path, hash, committed: hash === sha256(git(['show', report.candidate + ':' + path])) }));
assert.ok(sourceProof.every(entry => entry.committed));
const nativeRows = report.product.filter(row => row.kind === 'native').map(row => ({ id: row.id, originalAssertionPass: row.profiles, assertionError: row.actual.observations[0].error, actual: row.actual.observations[0].tuple, native: native.profiles.map(profile => { const expected = profile.rows.find(entry => entry.id === row.id).tuple; return { role: profile.role, expected, rawTupleMatch: isDeepStrictEqual(row.actual.observations[0].tuple, expected) }; }), ...(nativeCases.find(entry => entry.id === row.id).policyExpected ? { policyTupleMatch: isDeepStrictEqual(row.actual.observations[0].tuple, nativeCases.find(entry => entry.id === row.id).policyExpected) } : {}) }));
const host = report.product.filter(row => row.kind !== 'native').flatMap(row => row.actual.observations.map(observation => ({ id: row.id, ...observation })));
const children = report.children.map(child => { let alive = false; try { process.kill(-child.pid, 0); alive = true; } catch (error) { if (error.code !== 'ESRCH') throw error; } return { ...child, aliveAtAudit: alive }; });
assert.ok(children.every(child => !child.alive && !child.aliveAtAudit));
assert.equal(await access(report.scratch).then(() => true, error => error.code !== 'ENOENT'), false);
const excerpts = [];
for (const [revision, path, first, last] of [[report.candidate, 'src/shell/shell.ts', 133, 145], [report.candidate, 'src/shell/runtime.ts', 1335, 1356], [report.candidate, 'src/contracts/command.md', 1, 22], [report.candidate, 'src/commands/execution.ts', 83, 90], ['6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a', 'src/shell/shell.ts', 91, 103], ['6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a', 'src/shell/runtime.ts', 1305, 1315]]) {
  const content = git(['show', revision + ':' + path]); excerpts.push({ revision, path, sourceHash: sha256(content), first, last, text: content.toString().split('\n').slice(first - 1, last).join('\n') });
}
const guards = report.product.map(row => ({ id: row.id, valid: row.valid, loadedFiles: Object.keys(report.manifests[row.loaded]).length, installedBeforeAfterEqual: row.before === row.after, sourceBeforeAfterEqual: row.sourceBefore === row.sourceAfter, loadedMatchesTar: Object.entries(report.manifests[row.loaded]).every(([name, hash]) => packed[name] === hash), forbiddenCalls: row.actual.forbidden, resolved: row.actual.resolved }));
assert.ok(guards.every(row => row.valid && row.installedBeforeAfterEqual && row.sourceBeforeAfterEqual && row.loadedMatchesTar && !row.forbiddenCalls.length));
save('packed-core-84ab66c-audit.json', { at: new Date().toISOString(), candidate: report.candidate, independentVerifier: true, sourceProof, nativeRows, host, originalSummaryUnchanged: report.summary, rawTupleSummaryNotAssertionPass: native.profiles.map(profile => ({ role: profile.role, passed: nativeRows.filter(row => row.native.find(item => item.role === profile.role).rawTupleMatch).length, total: 10 })), guardSummary: guards, sourceReview: excerpts, children, scratchAbsent: true, tarballSha256: sha256(bytes), packedFiles: Object.keys(packed).length, sourceReviewNoExtraProductRuns: true, limitations: ['Frozen cross-exec local assertion assumes unsupported persistent sessions; retained, not corrected.', 'Frozen sink expectation incorrectly requires exact replacement to persist into a later default merge invoke; immediate env child map is exact.', 'Raw tuple-only observations are not an alternative green assertion denominator.', 'Budget/cancel assertions are reached before the faulty parent assertion; serialized caught error is then overwritten, limiting standalone identity/error evidence.', 'No fresh native capture, new semantic controls, hidden case inspection, source repair, packaging retry, or global suite.'] });
console.log(JSON.stringify({ strict: report.summary, raw: nativeRows.filter(row => row.native[0].rawTupleMatch).length, guards: guards.length, sourceProof: sourceProof.length, packed: Object.keys(packed).length, childrenAbsent: children.length }));
