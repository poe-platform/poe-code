import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const load = path => JSON.parse(readFileSync(join(owned, path)));
const manifest = load('FILE-MANIFEST.json');
const entries = [];
function visit(relative) {
  for (const entry of readdirSync(join(owned, relative), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(relative, entry.name);
    if (path === 'FILE-MANIFEST.json') continue;
    if (entry.isDirectory()) { entries.push({ path, kind: 'directory' }); visit(path); }
    else {
      assert(entry.isFile(), path);
      const bytes = readFileSync(join(owned, path));
      entries.push({ path, kind: 'file', bytes: bytes.length, sha256: hash(bytes) });
    }
  }
}
visit('');
assert.deepEqual(entries, manifest.entries, 'Every recorded byte and directory entry, including additions');
assert.equal(manifest.policySatisfied, false);
assert(!existsSync(join(owned, 'run-01/.work')));
function git(...args) {
  const result = spawnSync('git', args, { cwd: root, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  assert.ifError(result.error); assert.equal(result.status, 0);
  return result.stdout;
}
const source = load('run-01/source-test-bindings.json');
for (const entry of source.files) assert.equal(hash(git('show', `${source.baseline}:${entry.path}`)), entry.sha256, entry.path);
const preserved = load('run-01/preserved-historical-inputs.json');
for (const entry of preserved) {
  assert.equal(hash(git('show', `${entry.commit}:${entry.path}`)), entry.sha256, entry.path);
  assert.equal(hash(readFileSync(join(root, entry.path))), entry.sha256, entry.path);
}
const body = load('run-01/assertion-delta.json');
assert.equal(hash(git('show', `${body.candidate}:${body.path}`)), body.approvedSha256);
assert.equal(git('diff', '--name-only', body.baseline, body.candidate).toString().trim(), body.path);
const original = load('run-01/runtime-binding.original.json');
const approved = load('runtime-binding.v2.json');
const row = original.cases.find(input => input.id === 'syntax-output-one');
assert.deepEqual(row.argv, ['1', 'x']);
assert.deepEqual(row.limits, { maxOutputBytes: 1 });
assert.equal(row.expectedStatus, 2);
assert.equal(row.expectedStderr, "expr: syntax error: unexpected argument 'x'\n");
row.expectedStatus = 3;
row.expectedStderr = 'expr: output bytes limit exceeded\n';
assert.deepEqual(approved, original);
const summary = load('run-01/summary.json');
assert.deepEqual(summary.originalRuntime, { passed: 11, total: 12, red: ['syntax-output-one'] });
assert.deepEqual(summary.version2Runtime, { passed: 12, total: 12, red: [] });
assert.equal(summary.policySatisfied, false);
const blocker = load('run-01/ordinary-error-policy-blocker.json');
assert.equal(blocker.passed, false);
assert.deepEqual([blocker.actual.status, blocker.stdout, blocker.stderr, blocker.stderrBytes], [2, '', 'expr: division by zero\n', 23]);
const issue = readFileSync(join(owned, 'independent-proof-issue.txt.data'), 'utf8');
for (const path of ['src/commands/expr/index.ts', 'src/commands/expr/evaluate.ts', 'src/commands/expr/syntax.ts']) {
  const entry = source.files.find(input => input.path === path);
  assert(issue.includes(`${path} SHA256 ${entry.sha256}`), path);
}
console.log(JSON.stringify({ artifactEntries: entries.length, authenticatedSourceFiles: source.files.length,
  preservedHistoricalFiles: preserved.length, originalRuntime: summary.originalRuntime, version2Runtime: summary.version2Runtime,
  policySatisfied: false, ordinaryErrorPolicyBlockerRetained: true, scratchAbsent: true }));
