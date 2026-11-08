import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { artifact, digest, git, owned, read, root, source, target, tree } from './review.mjs';

const approval = JSON.parse(read(`${owned}/approval.json`));
const priorPath = 'tests/commands/structured-stress/jq-grammar-final-review/post-full-structured.json';
const prior = JSON.parse(read(priorPath));
const files = prior.command.filter(argument => argument.endsWith('.test.ts'));
assert.equal(files.length, 38);
assert.equal(new Set(files).size, 38);
assert.ok(files.includes(target));
const byteAssertions = 'tests/commands/structured-stress/jq-grammar-byte-assertions-v3.test.ts';
assert.ok(files.includes(byteAssertions));
const applicationCommit = git(['rev-parse', 'c0055e1']).toString().trim();
const approvalCommit = git(['rev-parse', 'e0c4b72']).toString().trim();
assert.deepEqual(git(['diff-tree', '--no-commit-id', '--name-only', '-r', applicationCommit]).toString().trim().split('\n'), [target]);
git(['merge-base', '--is-ancestor', approvalCommit, applicationCommit]);
assert.equal(digest(git(['show', `${applicationCommit}:${target}`])), approval.afterSha256);
const expected = { ...approval.frozenBefore, [target]: approval.afterSha256 };
function snapshot() {
  assert.equal(digest(read(target)), approval.afterSha256);
  assert.deepEqual(tree(['tests/commands/structured', 'tests/commands/structured-stress']), expected);
  return { structured: source(), product: tree(['src']), head: git(['rev-parse', 'HEAD']).toString().trim(), status: git(['status', '--short']).toString() };
}
function run(name, args, expectedTests) {
  const before = snapshot();
  const startedAt = new Date().toISOString();
  const command = [process.execPath, ...args];
  const result = spawnSync(command[0], command.slice(1), {
    cwd: root, env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --unhandled-rejections=strict` },
    timeout: 240000, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 24 * 1024 * 1024,
  });
  const endedAt = new Date().toISOString();
  const after = snapshot();
  const counts = Object.fromEntries([...result.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  const changedProduct = [...new Set([...Object.keys(before.product), ...Object.keys(after.product)])].filter(path => before.product[path] !== after.product[path]);
  const record = {
    command, startedAt, endedAt, watchdogMs: 240000, status: result.status, signal: result.signal,
    error: result.error ? String(result.error) : null, expectedTests, counts, before, after, changedProduct,
    stdout: result.stdout, stderr: result.stderr,
  };
  artifact(`${name}.json`, record);
  console.log(JSON.stringify({ name, status: result.status, counts, changedProduct }));
  return { name, status: result.status, counts, error: record.error, signal: result.signal, changedProduct };
}
const testFlags = ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-reporter=tap', '--test-timeout=180000'];
const initial = snapshot();
const results = [];
results.push(run('full-structured', [...testFlags, ...files], 3758));
results.push(run('target-and-byte-assertions', [...testFlags, target, byteAssertions], 17));
results.push(run('scoped-types', ['node_modules/typescript/bin/tsc', '--noEmit', '-p', `${owned}/tsconfig.json`, '--pretty', 'false'], null));
results.push(run('global-types', ['node_modules/typescript/bin/tsc', '--noEmit', '--pretty', 'false'], null));
const final = snapshot();
artifact('final-audit.json', {
  approvalCommit, applicationCommit, target, targetSha256: digest(read(target)),
  sourceSha256: final.structured.sha256,
  oldManifest: { ...approval.oldManifest, actualSha256: digest(read(approval.oldManifest.path)) },
  migrationManifest: { ...approval.migrationManifest, actualSha256: digest(read(approval.migrationManifest.path)) },
  frozenPaths: Object.keys(expected).length, changedFrozenPaths: [target],
  priorReport: { path: priorPath, sha256: digest(read(priorPath)), counts: prior.counts },
  priorReports: Object.fromEntries(Object.entries(expected).filter(([path]) => path.includes('/jq-grammar-final-review/'))),
  initial, final, results, exact38Files: files,
  duplicateCredit: 'The focused 2+15 tests are included in 3758, not additional unique coverage.',
  nativeRerun: false, full1344Rerun: false,
});
