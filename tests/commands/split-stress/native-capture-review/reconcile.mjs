import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const scope = dirname(fileURLToPath(import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const frozenBytes = await fs.readFile(join(scope, 'freeze.json'));
const resultBytes = await fs.readFile(join(scope, 'results.json'));
assert.equal(hash(frozenBytes), '0184acf695ec0203011ef4ca65e33bb4ccf8558e0b872ffa483bc392d5556520');
assert.equal(hash(resultBytes), '5f7c500dfb9473cc6ef50b6279ba187dab8146883e8ad9ef9e1c7ef6e9aa8b6a');
const frozen = JSON.parse(frozenBytes);
const result = JSON.parse(resultBytes);
const candidate = frozen.candidate;
const gnuRelative = frozen.native[0].path;
const suite = 'tests/commands/split';
const checks = [];
async function witness(path) {
  const stat = await fs.lstat(path);
  return { mode: stat.mode & 0o7777, size: stat.size, sha256: hash(stat.isSymbolicLink() ? await fs.readlink(path) : await fs.readFile(path)), ...(stat.isSymbolicLink() ? { link: await fs.readlink(path) } : {}) };
}
async function tree(directory) {
  const output = {};
  async function visit(path) {
    const stat = await fs.lstat(path);
    const name = relative(directory, path);
    if (stat.isDirectory()) {
      output[name] = { mode: stat.mode & 0o7777, directory: true };
      for (const entry of (await fs.readdir(path)).sort()) await visit(join(path, entry));
    } else output[name] = await witness(path);
  }
  await visit(directory);
  return output;
}
function git(...args) {
  const response = spawnSync('git', args, { cwd: root, maxBuffer: 20 * 1024 * 1024 });
  assert.equal(response.status, 0, response.stderr.toString());
  return response.stdout;
}
const assertionReviews = [];
for (const name of ['native.test.ts', 'native-errors.test.ts']) {
  function extract(revision) {
    const source = git('show', `${revision}:${suite}/${name}`).toString();
    const parsed = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
    const assertions = [], vectors = [], rawVectors = [];
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(parsed).startsWith('assert.')) assertions.push({ callee: node.expression.getText(parsed), arguments: node.arguments.map(argument => argument.getText(parsed)) });
      if (ts.isVariableDeclaration(node) && ['gnu', 'profiles', 'executable', 'scenarios'].includes(node.name.getText(parsed))) {
        rawVectors.push(node.getText(parsed));
        if (node.name.getText(parsed) === 'profiles' && ts.isAsExpression(node.initializer)) {
          assert.equal(node.initializer.type.getText(parsed), 'const');
          vectors.push('profiles = ' + node.initializer.expression.getText(parsed));
        } else vectors.push(node.getText(parsed));
      }
      if (ts.isForOfStatement(node) && ts.isArrayLiteralExpression(node.expression)) vectors.push(node.expression.getText(parsed));
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    return { sha256: hash(source), assertions, vectors, rawVectors };
  }
  const before = extract(candidate + '^');
  const after = extract(candidate);
  assert.deepEqual(after.vectors, before.vectors);
  assert.deepEqual(after.assertions.map(item => [item.callee, ...item.arguments.slice(0, 2)]), before.assertions.map(item => [item.callee, ...item.arguments.slice(0, 2)]));
  const changedMessages = after.assertions.flatMap((item, index) => JSON.stringify(item) === JSON.stringify(before.assertions[index]) ? [] : [{ before: before.assertions[index], after: item }]);
  assert.equal(changedMessages.length, 1);
  assertionReviews.push({ name, before, after, changedMessages });
}
assert.deepEqual(git('diff-tree', '--no-commit-id', '--name-only', '-r', candidate).toString().trim().split('\n').sort(), ['native.test.ts', 'native-errors.test.ts', 'native-capture.ts', 'native-capture.test.ts'].map(name => `${suite}/${name}`).sort());
const captures = [], negatives = [], allPaths = [], processChecks = [];
for (const record of result.runs.filter(record => record.mode !== 'guards')) {
  const negative = record.mode.startsWith('negative');
  const capture = record.mode.endsWith('capture');
  assert.equal(record.code, negative ? 1 : 0);
  assert.equal(record.signal, null);
  assert.match(record.stdout, negative ? /# pass 1\n# fail 3\n/ : /# pass 4\n# fail 0\n/);
  assert.match(record.stdout, /# skipped 0\n/);
  const paths = [...record.stdout.matchAll(/^# split native capture: (.+)$/gm)].map(match => match[1]);
  const scratches = [...record.stdout.matchAll(/^# split native scratch retained: (.+)$/gm)].map(match => match[1]);
  const diagnosticReports = [...record.stdout.matchAll(/^# split native failure ([^ ]+) \(base64\): (.+)$/gm)].map(match => ({ name: match[1], report: JSON.parse(Buffer.from(match[2], 'base64').toString()) }));
  assert.equal(paths.length, capture ? 4 : 0);
  assert.equal(scratches.length, negative ? 3 : 0);
  assert.equal(diagnosticReports.length, negative && !capture ? 3 : 0);
  assert.equal((await fs.readdir(record.temporary)).length, paths.length + scratches.length);
  const reports = [];
  for (const path of paths) {
    assert.equal(dirname(dirname(path)), record.temporary);
    assert.equal((await fs.lstat(path)).mode & 0o777, 0o600);
    assert.equal((await fs.lstat(dirname(path))).mode & 0o777, 0o700);
    const bytes = await fs.readFile(path);
    const report = JSON.parse(bytes);
    const entry = { mode: record.mode, path, witness: await witness(path), bytesBase64: bytes.toString('base64') };
    if (!negative) {
      const historicalName = basename(path) === 'native-profile-differences.json' ? basename(path) : basename(path, '.json') + '-latest.json';
      const historicalBytes = await fs.readFile(join(frozen.copy, suite, 'evidence', historicalName));
      const normalized = structuredClone(report);
      const normalizations = [];
      if (basename(path) === 'gnu9.7-darwin.json') {
        assert.equal(normalized.profile.executable, join(frozen.copy, gnuRelative));
        normalized.profile.executable = JSON.parse(historicalBytes).profile.executable;
        assert.equal(normalized.profile.executable, join(root, gnuRelative));
        normalizations.push('profile.executable');
      }
      if (basename(path) === 'gnu-errors.json') {
        const row = normalized.report.find(row => row.id === 'two-modes');
        assert.equal(row.expected.stderr, `split: cannot split in more than one way\nTry '${join(frozen.copy, gnuRelative)} --help' for more information.\n`);
        row.expected.stderr = `split: cannot split in more than one way\nTry '${join(root, gnuRelative)} --help' for more information.\n`;
        normalizations.push('report[id=two-modes].expected.stderr: exact argv[0] path only');
      }
      assert.equal(JSON.stringify(normalized, null, 2) + '\n', historicalBytes.toString());
      Object.assign(entry, { historicalName, historicalSHA256: hash(historicalBytes), rawByteIdentical: bytes.equals(historicalBytes), normalizedByteIdentical: true, normalizations, rows: (report.cohort ?? report.report ?? report).length });
    }
    captures.push(entry);
    reports.push({ name: basename(path, '.json'), report });
  }
  if (negative) {
    const failures = (capture ? reports : diagnosticReports).filter(item => item.name !== 'native-profile-differences');
    assert.equal(failures.length, 3);
    for (const item of failures) {
      const bad = (item.report.cohort ?? item.report.report).filter(row => (row.match ?? row.semanticMatch) === false);
      assert.equal(bad.length, 1);
      assert.equal(bad[0].id, item.name === 'gnu-errors' ? 'zero-lines' : 'default-empty');
      if (item.name === 'gnu-errors') { assert.equal(bad[0].expected.status, bad[0].observed.status); assert.equal(bad[0].expected.stderr, bad[0].observed.stderr); }
      else assert.deepEqual(bad[0].expected, bad[0].observed);
    }
    negatives.push({ mode: record.mode, deliberateFailures: 3, unchangedValues: true, reports: failures, scratches: await Promise.all(scratches.map(async path => ({ path, entries: await tree(path) }))) });
  }
  allPaths.push(...paths, ...scratches);
  checks.push({ mode: record.mode, testPass: negative ? 1 : 4, testFail: negative ? 3 : 0, skips: 0, captureCount: paths.length, retainedScratchCount: scratches.length, failureDiagnosticCount: diagnosticReports.length, tempEntries: (await fs.readdir(record.temporary)).sort() });
}
assert.equal(new Set(allPaths).size, allPaths.length);
for (const barrier of result.rendezvous) {
  assert.equal(barrier.allFourAliveBeforeRelease, true);
  assert.equal(new Set(barrier.members.map(member => member.pid)).size, 4);
  for (const member of barrier.members) {
    assert.ok(member.ready < barrier.release);
    const release = JSON.parse(await fs.readFile(join(frozen.temporary, barrier.prefix + '-barrier', `${member.pid}.released.json`), 'utf8'));
    assert.ok(release.released >= barrier.release);
  }
}
for (const pid of [...result.runs.map(record => record.pid), ...result.rendezvous.flatMap(barrier => barrier.members.map(member => member.pid))]) {
  let alive = true;
  try { process.kill(pid, 0); } catch (error) { assert.equal(error.code, 'ESRCH'); alive = false; }
  processChecks.push({ pid, alive });
  assert.equal(alive, false);
}
const guardResults = JSON.parse(await fs.readFile(join(frozen.temporary, 'guards/guard-results.json'), 'utf8'));
assert.equal(guardResults.results.length, 23);
assert.ok(guardResults.results.every(item => item.pass));
const live = {};
for (const [path, expected] of Object.entries(frozen.before.tracked)) { live[path] = await witness(join(root, path)); assert.deepEqual(live[path], expected, path); }
assert.deepEqual(await tree(join(root, suite)), frozen.before.splitTree);
assert.deepEqual(await tree(join(root, 'tests/integration/full-gate-20260827/combined-8670ebe8')), frozen.before.frozenTree);
assert.deepEqual(await tree(frozen.copy), frozen.copyBefore);
assert.deepEqual(await tree(frozen.mutant), frozen.mutantBefore);
for (const native of frozen.native) assert.deepEqual(await witness(native.path.startsWith('/') ? native.path : join(root, native.path)), native.actual);
const authorBefore = JSON.parse(await fs.readFile('/tmp/safe-bash-split-capture-repair-before.json', 'utf8'));
const originalEvidence = [];
for (const [path, expectedHash] of Object.entries(authorBefore.files).filter(([path]) => path.startsWith(suite + '/evidence/'))) {
  const actual = await witness(join(root, path));
  assert.equal(actual.sha256, expectedHash);
  originalEvidence.push({ path, beforeSHA256: expectedHash, after: actual });
}
const output = { candidate, frozenInputsCommit: 'f2fb2155365ec1c175b0891feec6ec4d2164f1ea', date: new Date().toISOString(), originalEvaluatorFailureRetained: true, assertionReviews, checks, captures, negatives, guardResults, processChecks, originalEvidence, integrity: { protectedTracked: Object.keys(live).length, protectedAfter: live, liveEqual: true, splitAndFrozenNewEntriesChecked: true, candidateAndMutationCopiesEqual: true, nativeEqual: true }, limits: ['GNU9.7 Darwin, not GNU/Linux', 'Two exact relocation fields normalized; original comparison failure retained', 'Negative controls force assertion failure without changing product/specimen values', 'No hostile namespace race guarantee', 'No whole8670 gate; edge/stress/dangling-native writers remain out of scope', 'No author helper suite, typecheck or performance claim'] };
const text = JSON.stringify(output, null, 2) + '\n';
const patch = spawnSync('apply_patch', [], { cwd: root, input: `*** Begin Patch\n*** Add File: ${join(scope, 'reconciliation.json')}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 });
assert.equal(patch.status, 0, patch.stderr);
console.log(JSON.stringify({ checks, guards: guardResults.results.length, captures: captures.length, rawHistoricalIdentical: captures.filter(item => item.rawByteIdentical).length, normalizedHistoricalIdentical: captures.filter(item => item.normalizedByteIdentical).length, assertions: assertionReviews.map(item => ({ name: item.name, count: item.after.assertions.length })), protected: Object.keys(live).length, originalEvidence: originalEvidence.length, processesRemaining: processChecks.filter(item => item.alive).length }));
