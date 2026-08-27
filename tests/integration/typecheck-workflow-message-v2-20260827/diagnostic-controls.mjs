import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('./', import.meta.url)), repository = fileURLToPath(new URL('../../../', import.meta.url));
const evidence = resolve(process.argv[2] ?? ''), output = resolve(process.argv[3] ?? '');
assert.ok(process.argv[2] && process.argv[3]); assert.equal(existsSync(output), false);
const priorCommit = '39116ae1da80261d1a55df363f615430eab6609a';
const priorPath = 'tests/integration/typecheck-workflow-independent-20260827-closure/unchanged-cohort.mjs';
const previous = execFileSync('git', ['--no-replace-objects', 'show', `${priorCommit}:${priorPath}`], { cwd: repository, encoding: 'utf8' });
const fixture = readFileSync(join(root, 'cohort-v2.mjs'), 'utf8');
const oldStatement = '      assert.match(result.details.result.groups[0].error, /candidate build/u);';
const newStatement = "      assert.equal(result.details.result.groups[0].error, `foreign candidate declaration/source fallback: virtual-bash -> ${join(snapshot, 'src/index.ts')}`);";
assert.equal(previous.split(oldStatement).length, 2);
assert.equal(fixture, previous.replace(oldStatement, newStatement), 'only the approved message assertion may change');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const cohort = JSON.parse(readFileSync(join(evidence, 'report.json')));
assert.equal(cohort.candidate, 'a01310c5571dfda2aae4c6c8cc185e2530a01e89');
assert.equal(cohort.harnessSha256, hash(fixture));
assert.deepEqual(cohort.counts, { pass: 21, fail: 0, skip: 0 });
const capturedPath = 'source-fallback-negative.report.gz.base64';
const raw = gunzipSync(Buffer.from(readFileSync(join(evidence, capturedPath), 'utf8'), 'base64'));
const captured = cohort.captures.find(entry => entry.path === capturedPath);
assert.equal(raw.length, captured.bytes); assert.equal(hash(raw), captured.sha256);
const fallback = JSON.parse(raw);
assert.equal(fallback.phases[0].status, 0); assert.equal(fallback.result.passed, false);
assert.equal(cohort.commands.find(command => command.label === 'source-fallback-negative').status, 2);
const actual = fallback.result.groups[0].error;
const prefix = 'foreign candidate declaration/source fallback: virtual-bash -> ';
assert.ok(actual.startsWith(prefix)); assert.ok(actual.endsWith('/src/index.ts'));
const snapshot = actual.slice(prefix.length, -'/src/index.ts'.length);
const cases = [
  { name: 'actual-candidate-binding-rejection', error: actual, accept: true },
  { name: 'unrelated-compiler-diagnostic', error: 'TS2305: unrelated public export is missing', accept: false },
  { name: 'unrelated-error-mentions-candidate-build', error: 'candidate build failed: ENOENT', accept: false },
  { name: 'wrong-package-binding', error: actual.replace('virtual-bash ->', 'unrelated-package ->'), accept: false },
  { name: 'wrong-candidate-path', error: actual.replace('/src/index.ts', '/src/unrelated.ts'), accept: false },
  { name: 'expected-message-is-only-substring', error: `unrelated error: ${actual}`, accept: false },
  { name: 'trailing-unrelated-failure', error: `${actual}\nunrelated failure`, accept: false },
  { name: 'missing-error', accept: false },
  { name: 'null-error', error: null, accept: false },
];
const temporary = mkdtempSync(join(tmpdir(), 'safe-bash-diagnostic-v2-'));
const report = { fixtureSha256: hash(fixture), previousFixtureSha256: hash(previous), priorCommit, priorPath, onlyApprovedStatementChanged: true, candidate: cohort.candidate, actualCompilerStatus: fallback.phases[0].status, actualHelperStatus: 2, actualDiagnostic: actual, sourceCaptureSha256: hash(raw), cases, children: [] };
const environment = { ...process.env }; delete environment.NODE_OPTIONS; delete environment.NODE_TEST_CONTEXT;
try {
  for (const [name, statement] of [['strict-fixture-line', newStatement], ['unrelated-nonempty-error-mutant', '      assert.ok(result.details.result.groups[0].error);']]) {
    const path = join(temporary, `${name}.mjs`);
    const script = `import assert from 'node:assert/strict';
import {join} from 'node:path';
const snapshot = ${JSON.stringify(snapshot)};
const cases = ${JSON.stringify(cases)};
for (const current of cases) {
  const result = {details:{result:{groups:[{error:current.error}]}}};
  const inspect = () => {
${statement}
  };
  if (current.accept) inspect();
  else assert.throws(inspect, {code:'ERR_ASSERTION'}, current.name);
  console.log(JSON.stringify({name:current.name,status:'pass'}));
}
`;
    writeFileSync(path, script);
    const child = spawnSync(process.execPath, [path], { env: environment, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    report.children.push({ name, sourceSha256: hash(script), status: child.status, signal: child.signal, error: child.error?.message, stdout: child.stdout, stderr: child.stderr });
    assert.equal(child.error, undefined); assert.equal(child.signal, null);
    if (name === 'strict-fixture-line') { assert.equal(child.status, 0); assert.equal(child.stderr, ''); assert.equal(child.stdout.trim().split('\n').length, cases.length); }
    else { assert.equal(child.status, 1); assert.match(child.stderr, /Missing expected exception.*unrelated-compiler-diagnostic/u); }
  }
  report.status = 'pass';
} catch (error) { report.status = 'fail'; report.error = error.stack; process.exitCode = 1; }
finally {
  rmSync(temporary, { recursive: true, force: true }); report.cleaned = !existsSync(temporary);
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, diagnosticControls: cases.length, rejectedWeakMutant: report.children.find(child => child.name === 'unrelated-nonempty-error-mutant')?.status === 1, cleaned: report.cleaned, output }));
}
