import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, '../../..');
const candidateRevision = 'f8819e9d6b6d535b0626e0aa004bb10a7bc36785';
const executable = '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node';
const executableHash = '4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0';
const output = resolve(process.argv[2] ?? ''); assert.ok(process.argv[2]); assert.equal(existsSync(output), false); mkdirSync(output, { recursive: true });
const temporary = realpathSync(mkdtempSync('/tmp/shared-stdin-fix-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
const environment = { ...process.env, PATH: `${dirname(executable)}:/usr/bin:/bin`, HOME: temporary, TMPDIR: temporary, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', TSX_DISABLE_CACHE: '1', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
delete environment.NODE_OPTIONS; delete environment.NODE_PATH; delete environment.NODE_TEST_CONTEXT; delete environment.SAFEJS_LOCAL_ROOT;
const git = args => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repository, env: environment, timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
const blob = (revision, path) => git(['show', `${revision}:${path}`]);
const parent = git(['rev-parse', '3af3f628^']).toString().trim();
const regression = 'tests/shell/input-return-cleanup.test.ts';
const historicalPrefix = 'tests/integration/shared-external-stdin-review-20260827';
const report = { candidateRevision, parent, startedAt: new Date().toISOString(), executable, executableHash, runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), historicalEvidence: '28f13113', authorOnly: true, profiles: [], tools: {}, privateAccess: false, productChangesBeyondInput: false, wholeGate: false };
function inventory(directory) {
  const entries = {};
  function visit(current) { for (const name of readdirSync(current).sort()) { const path = join(current, name), key = relative(directory, path), stat = lstatSync(path); assert.equal(stat.isSymbolicLink(), false, path); if (stat.isDirectory()) { entries[key + '/'] = { type: 'directory' }; visit(path); } else { assert.ok(stat.isFile(), path); entries[key] = { sha256: hash(readFileSync(path)), mode: stat.mode & 0o777 }; } } }
  visit(directory); return entries;
}
const unchangedTests = ['tests/contracts/io.test.ts', 'tests/contracts/io.stress.test.ts', 'tests/shell/invocation-cleanup.test.ts', 'tests/shell/invocation-cleanup-pipeline.test.ts', 'tests/shell/lifecycle.test.ts'];
const files = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'tests/shell/helpers.ts', 'tests/shell/lifecycle-probe.ts', ...unchangedTests];
const counts = text => Object.fromEntries([...text.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
try {
  assert.equal(hash(readFileSync(executable)), executableHash);
  assert.deepEqual(blob(parent, 'src/shell/input.ts'), blob('eaed12f8', 'src/shell/input.ts'));
  for (const path of unchangedTests) assert.deepEqual(blob(candidateRevision, path), blob('eaed12f8', path), path);
  assert.deepEqual(git(['diff-tree', '--no-commit-id', '--name-only', '-r', candidateRevision]).toString().trim().split('\n').sort(), ['src/shell/input.ts', regression].sort());
  write(join(output, 'SOURCE-DELTA.diff.txt'), git(['diff', parent, candidateRevision, '--', 'src/shell/input.ts', regression]));
  write(join(output, 'HISTORICAL-TO-PARENT.diff.txt'), git(['diff', '--stat', 'eaed12f8', parent, '--', 'src']));
  const tools = JSON.parse(blob('0579a239', 'tests/integration/full-gate-20260827/loader-null-source-review-node24-bodies/attempt-1/RESULT.json')).tools;
  const originalProbe = blob('8aa4db42', historicalPrefix + '/probe.mjs');
  report.originalProbeSha256 = hash(originalProbe);
  report.regressionSha256 = hash(blob(candidateRevision, regression));
  for (const [label, revision] of [['before', parent], ['after', candidateRevision]]) {
    const root = join(temporary, label), candidate = join(root, 'candidate'), capture = join(output, label); mkdirSync(candidate, { recursive: true }); mkdirSync(capture);
    const profile = { label, revision, candidate, commands: [], testRevision: candidateRevision }; report.profiles.push(profile);
    const tar = join(root, 'source.tar'); git(['archive', '-o', tar, revision, ...files]); execFileSync('/usr/bin/tar', ['-xf', tar, '-C', candidate]);
    write(join(candidate, regression), blob(candidateRevision, regression));
    write(join(capture, 'SOURCE.json'), JSON.stringify(inventory(candidate), null, 2) + '\n');
    for (const [path, pin] of Object.entries(tools)) { const bytes = readFileSync(join(repository, 'node_modules', path)); assert.equal(hash(bytes), pin.sha256, path); const destination = join(candidate, 'node_modules', path); write(destination, bytes); chmodSync(destination, pin.mode); report.tools[path] = pin; }
    const child = (name, args) => {
      const result = spawnSync(executable, args, { cwd: candidate, env: environment, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
      write(join(capture, `${name}.stdout.txt`), result.stdout ?? ''); write(join(capture, `${name}.stderr.txt`), result.stderr ?? '');
      profile.commands.push({ name, executable, args, status: result.status, signal: result.signal, error: result.error?.message ?? null });
      assert.equal(result.signal, null, name); assert.equal(result.error, undefined, name); return result;
    };
    assert.equal(child('build', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']).status, 0);
    assert.equal(child('scoped-types', ['node_modules/typescript/bin/tsc', '--noEmit', '--target', 'ES2023', '--lib', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--skipLibCheck', '--types', 'node', regression]).status, 0);
    const built = inventory(candidate); write(join(capture, 'BUILT.json'), JSON.stringify(built, null, 2) + '\n');
    const focused = child('focused', ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-reporter=tap', regression]); profile.focused = counts(focused.stdout);
    assert.equal(focused.status, label === 'before' ? 1 : 0);
    assert.deepEqual(profile.focused, { tests: 22, pass: label === 'before' ? 7 : 22, fail: label === 'before' ? 15 : 0, cancelled: 0, skipped: 0, todo: 0 });
    const unchanged = child('unchanged', ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-reporter=tap', '--test-concurrency=1', ...unchangedTests]); profile.unchanged = counts(unchanged.stdout);
    assert.equal(unchanged.status, 0); assert.deepEqual(profile.unchanged, { tests: 63, pass: 63, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
    const probe = join(root, 'original-probe.mjs'); write(probe, originalProbe);
    const original = child('original-diagnosis', ['--unhandled-rejections=strict', probe, candidate, join(capture, 'ORIGINAL-CASES.json')]);
    const observed = JSON.parse(readFileSync(join(capture, 'ORIGINAL-CASES.json'))); profile.originalDiagnosis = observed.counts;
    assert.equal(original.status, label === 'before' ? 0 : 1);
    assert.deepEqual(observed.unhandled, []); assert.equal(observed.cases.length, 34);
    if (label === 'after') {
      const before = JSON.parse(readFileSync(join(output, 'before/ORIGINAL-CASES.json')));
      const defective = before.cases.filter(entry => entry.behaviorAccepted === false).map(entry => entry.name).sort();
      const changed = observed.cases.filter(entry => !entry.observationVerified).map(entry => entry.name).sort();
      assert.deepEqual(changed, defective); assert.equal(changed.length, 9);
      profile.oldCharacterizationChanges = changed;
    } else assert.deepEqual(observed.counts, { observations: 34, verified: 34, unexpected: 0, retainedDefectRows: 9 });
    const columnProbe = join(root, 'original-column.mjs'); write(columnProbe, blob('eaed12f8', 'tests/commands/column-stress/handoff-20260827/root-hidden-return-repro.mjs'));
    const originalColumn = child('original-column-hold', [columnProbe, candidate, join(capture, 'ORIGINAL-COLUMN.json')]);
    assert.equal(originalColumn.status, 1); assert.equal(JSON.parse(readFileSync(join(capture, 'ORIGINAL-COLUMN.json'))).acceptance, 'HOLD');
    const after = inventory(candidate); assert.deepEqual(after, built); profile.inventoryUnchangedIncludingNewEntries = true;
    write(join(capture, 'AFTER.json'), JSON.stringify(after, null, 2) + '\n');
    console.log(JSON.stringify({ profile: label, focused: profile.focused, unchanged: profile.unchanged, oldCharacterization: profile.originalDiagnosis }));
  }
} catch (error) { report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally { rmSync(temporary, { recursive: true, force: true }); report.cleaned = !existsSync(temporary); report.finishedAt = new Date().toISOString(); write(join(output, 'RESULT.json'), JSON.stringify(report, null, 2) + '\n'); }
console.log(JSON.stringify({ candidateRevision, error: report.error, cleaned: report.cleaned }));
