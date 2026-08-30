import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2]); assert.equal(existsSync(output), false);
const owner = 'tests/integration/typecheck-workflow-message-v2-20260827';
const originalOwner = 'tests/integration/typecheck-workflow-independent-20260827-closure';
const originalCommit = '39116ae1da80261d1a55df363f615430eab6609a';
const fixtureCommit = 'c7f2abab5e11539c69f890e617a461cbd5ec4a08';
const evidenceCommit = execFileSync('git', ['rev-parse', '0cb0c438'], { cwd: root }).toString().trim();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const committed = (revision, path) => execFileSync('git', ['--no-replace-objects', 'show', `${revision}:${path}`], { cwd: root, maxBuffer: 96 * 1024 * 1024 });
const old = committed(originalCommit, `${originalOwner}/unchanged-cohort.mjs`).toString();
const current = committed(fixtureCommit, `${owner}/cohort-v2.mjs`).toString();
const before = '      assert.match(result.details.result.groups[0].error, /candidate build/u);';
const after = "      assert.equal(result.details.result.groups[0].error, `foreign candidate declaration/source fallback: virtual-bash -> ${join(snapshot, 'src/index.ts')}`);";
assert.equal(old.split(before).length, 2); assert.equal(current, old.replace(before, after));
assert.deepEqual(readFileSync(join(root, owner, 'cohort-v2.mjs')), Buffer.from(current));
const manifest = JSON.parse(committed(evidenceCommit, `${owner}/MANIFEST.json`));
for (const entry of manifest.files) {
  const bytes = readFileSync(join(root, owner, entry.path));
  assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256);
  assert.deepEqual(bytes, committed(evidenceCommit, `${owner}/${entry.path}`));
}
const report = JSON.parse(readFileSync(join(root, owner, 'evidence/cohort/report.json')));
const oldReport = JSON.parse(committed(originalCommit, `${originalOwner}/evidence/unchanged/report.json`));
assert.deepEqual(oldReport.counts, { pass: 20, fail: 1, skip: 0 });
assert.deepEqual(report.counts, { pass: 21, fail: 0, skip: 0 });
assert.equal(oldReport.candidate, report.candidate);
assert.deepEqual(oldReport.checks.map(entry => entry.name), report.checks.map(entry => entry.name));
const changed = oldReport.checks.filter((entry, index) => entry.status !== report.checks[index].status);
assert.deepEqual(changed.map(entry => entry.name), ['source-consumer-package-resolution-rejects-repository-src']);
const captures = new Map();
for (const entry of report.captures) {
  const bytes = gunzipSync(Buffer.from(readFileSync(join(root, owner, 'evidence/cohort', entry.path), 'utf8'), 'base64'));
  assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256); captures.set(entry.path, bytes);
}
const capture = name => JSON.parse(captures.get(`${name}.gz.base64`));
const fallback = capture('source-fallback-negative.report');
assert.equal(fallback.phases[0].status, 0);
assert.equal(report.commands.find(entry => entry.label === 'source-fallback-negative').status, 2);
const diagnostic = fallback.result.groups[0].error;
const prefix = 'foreign candidate declaration/source fallback: virtual-bash -> ';
assert.ok(diagnostic.startsWith(prefix)); assert.ok(diagnostic.endsWith('/src/index.ts'));
const snapshot = diagnostic.slice(prefix.length, -'/src/index.ts'.length);
const inspect = new Function('assert', 'join', 'snapshot', 'result', after);
const neighbors = [
  ['actual diagnostic', diagnostic, true],
  ['unrelated TS error', 'TS2305: unrelated compiler error', false],
  ['wrong root with same tail', `${prefix}/different-candidate/src/index.ts`, false],
  ['wrong public subpath', diagnostic.replace('virtual-bash ->', 'virtual-bash/contracts ->'), false],
  ['terminal newline', `${diagnostic}\n`, false],
  ['NUL suffix', `${diagnostic}\0`, false],
  ['coercible object', { toString: () => diagnostic }, false],
  ['boxed string', new String(diagnostic), false],
  ['missing', undefined, false],
];
for (const [name, value, accepted] of neighbors) {
  const invoke = () => inspect(assert, join, snapshot, { details: { result: { groups: [{ error: value }] } } });
  if (accepted) invoke(); else assert.throws(invoke, { code: 'ERR_ASSERTION' }, name);
}
assert.deepEqual(capture('source-before'), capture('source-after'));
const temporary = mkdtempSync(join(tmpdir(), 'safe-bash-message-review-'));
const children = [];
try {
  for (const args of [
    [`${owner}/verify.mjs`],
    [`${owner}/diagnostic-controls.mjs`, join(root, owner, 'evidence/cohort'), join(temporary, 'diagnostics.json')],
  ]) {
    const child = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    children.push({ args, status: child.status, signal: child.signal, error: child.error?.message, stdout: child.stdout, stderr: child.stderr });
    assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0);
  }
  const diagnostics = JSON.parse(readFileSync(join(temporary, 'diagnostics.json')));
  assert.equal(diagnostics.cleaned, true); assert.equal(diagnostics.status, 'pass');
  writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), fixtureCommit, evidenceCommit, originalCommit,
    candidate: report.candidate, changedLines: [248], oldFixtureSha256: hash(old), newFixtureSha256: hash(current),
    unchangedOtherCases: 20, originalCounts: oldReport.counts, authenticatedAuthorCounts: report.counts,
    authenticatedCaptures: captures.size, authenticatedFiles: manifest.files.length,
    freshIndependentNeighbors: neighbors.map(([name, , accepted]) => ({ name, accepted, status: 'pass' })),
    freshAuthorDiagnosticControls: diagnostics, children, fullTypeCohortRerun: false, compilerRuns: 0, productExecutions: 0,
    verdict: 'accept assertion-only fixture migration; no new product repair or whole-gate acceptance',
  }, null, 2) + '\n', { flag: 'wx' });
} finally { rmSync(temporary, { recursive: true, force: true }); assert.equal(existsSync(temporary), false); }
console.log(JSON.stringify({ changedLines: [248], unchangedOtherCases: 20, freshAuthorControls: 9, freshIndependentNeighbors: neighbors.length, fullTypeCohortRerun: false, output }));
