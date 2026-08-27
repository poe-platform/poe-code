import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = resolve(process.argv[2]); assert.ok(output.startsWith('/tmp/') && !existsSync(output));
const base = 'tests/integration/shared-external-stdin-independent-20260827';
const fixture = '8e5fec07ec9a39582987736269bbed51caeb795e', evidence = '4f3a3115cf5cdf365ee2877ce04e2ef951aed491';
const prior = 'd9a58cdc1d4fee159e21c76c708267628767bbf4', old35 = '92f7626200d1509cf0efe17e4ee6c3d558f3a277', oldColumn = '79f0f91717a4e3df328981c7d4988b129c417706';
const blob = (revision, path) => execFileSync('git', ['--no-replace-objects', 'show', revision + ':' + path], { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const text = (revision, path) => blob(revision, path).toString();
const report = { fixture, evidence, prior, candidate: 'f8819e9d6b6d535b0626e0aa004bb10a7bc36785', checks: [], authenticated: [], productExecutions: 0 };
function check(name, action) { action(); report.checks.push(name); }
function replaceOnce(value, before, after) { assert.equal(value.split(before).length, 2); return value.replace(before, after); }
try {
  const freeze = JSON.parse(blob(fixture, base + '/fixture-v2/FREEZE.json'));
  check('all committed fixture and execution bytes authenticate', () => {
    for (const entry of freeze.files) {
      const path = base + '/fixture-v2/' + entry.path, expected = blob(fixture, path), actual = readFileSync(resolve(repository, path));
      assert.equal(hash(expected), entry.sha256); assert.equal(expected.length, entry.size); assert.deepEqual(actual, expected);
      report.authenticated.push({ revision: fixture, path, sha256: hash(actual) });
    }
  });
  const oldProbe = text(old35, base + '/probe.mjs'), newProbe = text(fixture, base + '/fixture-v2/probe.mjs');
  check('exact primary-branch assertion change only; all other probe bytes identical', () => {
    const start = oldProbe.indexOf('  } else if (spec.kind === "primary") {'), end = oldProbe.indexOf('  } else if (spec.kind === "sink") {');
    assert.ok(start > 0 && end > start);
    const before = oldProbe.slice(start, end);
    const after = replaceOnce(before, '    rejected(actual, closeError);', '    assert.equal(actual.ok, true, "ordinary primary read failure fulfills");\n    assert.equal(actual.value.exitCode, 1);\n    assert.equal(actual.value.stdout, "");\n    assert.equal(output.join(""), "");');
    assert.equal(oldProbe.slice(0, start) + after + oldProbe.slice(end), newProbe);
    report.primaryBranchBefore = before; report.primaryBranchAfter = after;
  });
  const oldCases = text(old35, base + '/cases.mjs'), newCases = text(fixture, base + '/fixture-v2/cases.mjs');
  check('only the two primary-case descriptions change in cases source', () => {
    assert.equal(replaceOnce(oldCases, 'ordinary read error becomes command status/diagnostic, not selected rejection; awaited outer return failure must still reject', 'ordinary primary read error fulfills with status 1 and exact primary diagnostic; secondary return rejection does not replace it; no output, one read and one return'), newCases);
  });
  const loadCases = code => import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  const oldModule = await loadCases(oldCases), newModule = await loadCases(newCases);
  check('all35 semantic inputs and historical controls identical', () => {
    const inputs = module => module.cases.map(({ expected, ...input }) => input);
    assert.equal(oldModule.cases.length, 35); assert.deepEqual(inputs(oldModule), inputs(newModule));
    assert.deepEqual(oldModule.controls, newModule.controls);
    const changed = oldModule.cases.filter((row, index) => row.expected !== newModule.cases[index].expected).map(row => row.id);
    assert.deepEqual(changed, ['shell-primary-read-zero', 'shell-primary-read-error']);
    report.caseInputs = inputs(newModule); report.changedCaseIds = changed;
  });
  check('loader bytes unchanged from provisional fixture', () => { assert.deepEqual(blob(old35, base + '/loader.mjs'), blob(fixture, base + '/fixture-v2/loader.mjs')); });
  check('column delta is only the exact EFBIG diagnostic; all six inputs/assertions otherwise unchanged', () => {
    const before = text(oldColumn, base + '/candidate-review/column-close.mjs'), after = text(fixture, base + '/fixture-v2/column-close.mjs');
    assert.equal(replaceOnce(before, '"column: input limit exceeded\\n"', '"column: EFBIG: column input limit exceeded\\n"'), after);
    report.columnBeforeSha256 = hash(Buffer.from(before)); report.columnAfterSha256 = hash(Buffer.from(after));
  });
  check('author negative copies alter one diagnostic assertion each, never source', () => {
    assert.equal(replaceOnce(newProbe, 'assert.equal(errors.join(""), `shell: line 1: ${spec.mode === "zero" ? "0" : primaryError.message}\\n`);', 'assert.equal(errors.join(""), `shell: line 1: ${closeError.message}\\n`);'), text(fixture, base + '/fixture-v2/probe-wrong-primary.mjs'));
    assert.equal(replaceOnce(text(fixture, base + '/fixture-v2/column-close.mjs'), '"column: EFBIG: column input limit exceeded\\n"', '"column: EIO: column input limit exceeded\\n"'), text(fixture, base + '/fixture-v2/column-wrong-code.mjs'));
  });
  for (const [revision, directory] of [[prior, 'candidate-review'], [evidence, 'fixture-v2']]) {
    const seal = JSON.parse(blob(revision, base + '/' + directory + '/SEAL.json'));
    check(directory + ' complete historical evidence seal remains unchanged', () => {
      for (const entry of seal.files) {
        const path = base + '/' + directory + '/' + entry.path, expected = blob(revision, path), actual = readFileSync(resolve(repository, path));
        assert.equal(hash(expected), entry.sha256); assert.equal(expected.length, entry.size); assert.deepEqual(actual, expected);
        report.authenticated.push({ revision, path, sha256: hash(actual) });
      }
    });
  }
  report.status = 'audit-pass';
} catch (error) { report.status = 'audit-failed'; report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, authenticated: report.authenticated.length, error: report.error, output }));
