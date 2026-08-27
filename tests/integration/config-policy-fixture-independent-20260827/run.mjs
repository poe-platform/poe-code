import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, '../../..');
const revision = '91d56dbececa0cbc273c7680c60cf9a054470414', prefix = 'tests/plugins/qualified-current-release-native-data', testPath = prefix + '/controls.test.ts';
const executable = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const output = resolve(process.argv[2] ?? ''); assert.ok(process.argv[2]); assert.equal(existsSync(output), false); mkdirSync(output, { recursive: true });
const temporary = realpathSync(mkdtempSync('/tmp/compiler-policy-independent-')), root = join(temporary, 'source'); mkdirSync(root);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
const environment = { ...process.env, PATH: `${dirname(executable)}:/usr/bin:/bin`, HOME: temporary, TMPDIR: temporary, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', TSX_DISABLE_CACHE: '1', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
delete environment.NODE_OPTIONS; delete environment.NODE_PATH; delete environment.NODE_TEST_CONTEXT;
const git = args => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repository, env: environment, timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
const blob = (path, commit = revision) => git(['show', `${commit}:${path}`]);
const report = { revision, runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), startedAt: new Date().toISOString(), executable, binarySha256: hash(readFileSync(executable)), source: {}, checks: [], children: [], tools: {}, productionEdits: false, fullGate: false };
function inventory(directory) { const entries = {}; function visit(current) { for (const name of readdirSync(current).sort()) { const path = join(current, name), key = relative(directory, path), stat = lstatSync(path); assert.equal(stat.isSymbolicLink(), false, path); if (stat.isDirectory()) { entries[key + '/'] = 'directory'; visit(path); } else entries[key] = hash(readFileSync(path)); } } visit(directory); return entries; }
function check(name, action) { try { const detail = action(); report.checks.push({ name, pass: true, detail }); } catch (error) { report.checks.push({ name, pass: false, error: String(error) }); } console.log(JSON.stringify(report.checks.at(-1))); }
function child(name, args) { const result = spawnSync(executable, args, { cwd: root, env: environment, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 }); write(join(output, name + '.stdout.txt'), result.stdout ?? ''); write(join(output, name + '.stderr.txt'), result.stderr ?? ''); const counts = Object.fromEntries([...result.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])])); report.children.push({ name, args, status: result.status, signal: result.signal, error: result.error?.message ?? null, counts }); assert.equal(result.signal, null); assert.equal(result.error, undefined); return { ...result, counts }; }
const testArgs = ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-reporter=tap'];
try {
  assert.equal(report.binarySha256, '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
  const paths = ['package.json', 'tsconfig.json', testPath, prefix + '/helpers.ts', prefix + '/classification.json', prefix + '/before-02.json', 'tests/plugins/qualified-current-release/captured-types.json', 'tests/plugins/qualified-current-release/consumers.mjs', 'tests/integration/adapter-tools/atomic-webdav-profile/atomic-mock.ts', 'tests/integration/adapter-tools/atomic-webdav-profile/controls.ts', 'tests/integration/adapter-tools/atomic-webdav-profile-independent/hidden.ts', 'tests/shell-stress/env-split-consumer/packed-public-types.ts'];
  for (const path of paths) { const bytes = blob(path); write(join(root, path), bytes); report.source[path] = hash(bytes); }
  const tools = JSON.parse(blob('tests/integration/full-gate-20260827/loader-null-source-review-node24-bodies/attempt-1/RESULT.json', '0579a239')).tools;
  for (const [path, pin] of Object.entries(tools)) { const bytes = readFileSync(join(repository, 'node_modules', path)); assert.equal(hash(bytes), pin.sha256); write(join(root, 'node_modules', path), bytes); chmodSync(join(root, 'node_modules', path), pin.mode); report.tools[path] = pin; }
  const before = inventory(root); write(join(output, 'BEFORE.json'), JSON.stringify(before, null, 2) + '\n');
  check('source commit changes only the maintained fixture', () => assert.deepEqual(git(['diff-tree', '--no-commit-id', '--name-only', '-r', revision]).toString().trim().split('\n'), [testPath]));
  check('compiler and package configuration bytes unchanged by migration', () => { for (const path of ['tsconfig.json', 'package.json']) assert.deepEqual(blob(path), blob(path, revision + '^')); });
  const classification = JSON.parse(blob('tests/plugins/qualified-current-release/captured-types.json'));
  check('five captured source entries and provenance remain authenticated', () => { assert.equal(classification.entries.length, 5); for (const entry of [...classification.entries, ...classification.evidence]) assert.equal(hash(blob(entry.path)), entry.sha256, entry.path); return { capturedFiles: classification.entries.length, provenanceFiles: classification.evidence.length }; });
  check('all72 declared historical native artifacts remain authenticated', () => { const manifest = JSON.parse(blob(prefix + '/classification.json')); assert.equal(manifest.files.length, 72); for (const entry of manifest.files) assert.equal(hash(blob(entry.path)), entry.sha256, entry.path); });
  const source = blob(testPath).toString(), original = blob(testPath, revision + '^').toString();
  function cases(text) { const starts = [...text.matchAll(/^test\("([^"]+)"/gmu)]; return starts.map((match, index) => ({ name: match[1], text: text.slice(match.index, starts[index + 1]?.index ?? text.length).trimEnd() })); }
  check('four unaffected original test bodies retain exact bytes', () => { const old = cases(original), current = cases(source); let count = 0; for (const entry of old) { const same = current.find(row => row.name === entry.name); if (same) { assert.equal(same.text, entry.text, entry.name); count++; } } assert.equal(count, 4); });
  check('unchanged revised fixture executes8of8', () => { const result = child('revised-eight', [...testArgs, testPath]); assert.equal(result.status, 0, result.stdout + result.stderr); assert.deepEqual(result.counts, { tests: 8, pass: 8, fail: 0, cancelled: 0, skipped: 0, todo: 0 }); });
  check('original fixture still preserves4of5 against approved config', () => { write(join(root, testPath), original); try { const result = child('original-five', [...testArgs, testPath]); assert.equal(result.status, 1); assert.deepEqual(result.counts, { tests: 5, pass: 4, fail: 1, cancelled: 0, skipped: 0, todo: 0 }); } finally { write(join(root, testPath), source); } });
  check('strict scoped TypeScript check succeeds without suppression', () => { const result = child('strict-types', ['node_modules/typescript/bin/tsc', '--noEmit', '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--skipLibCheck', 'false', '--types', 'node', testPath]); assert.equal(result.status, 0, result.stdout + result.stderr); });
  const configPath = join(root, 'tsconfig.json'), configBytes = readFileSync(configPath);
  for (const [name, mutate] of [
    ['extra-current-source', config => config.exclude.push('src/contracts/**')],
    ['lookalike-capture-path', config => { config.exclude[config.exclude.length - 1] += '/'; }],
    ['sixth-flat-capture', config => config.exclude.push('tests/commands/filesystem-inspection-stress/tree/sealed/inputs/src__contracts__errors.ts')],
    ['strict-null-disabled', config => { config.compilerOptions.strictNullChecks = false; }],
  ]) check('independent policy mutation rejected: ' + name, () => {
    const config = JSON.parse(configBytes); mutate(config); write(configPath, JSON.stringify(config));
    try { const result = child('mutant-' + name, [...testArgs, '--test-name-pattern=^root compiler configuration', testPath]); assert.equal(result.status, 1); assert.equal(result.counts.fail, 1); assert.equal(result.counts.pass, 0); assert.match(result.stdout, /not ok \d+ - root compiler configuration/u); } finally { write(configPath, configBytes); }
  });
  check('self-comparison mutant fails the actual mutation guard', () => { const needle = 'assert.deepEqual(current, approvedCompilerConfiguration());'; assert.equal(source.split(needle).length, 2); write(join(root, testPath), source.replace(needle, 'assert.deepEqual(current, current);')); try { const result = child('self-comparison-mutant', [...testArgs, testPath]); assert.equal(result.status, 1); assert.deepEqual(result.counts, { tests: 8, pass: 7, fail: 1, cancelled: 0, skipped: 0, todo: 0 }); assert.match(result.stdout, /not ok \d+ - compiler-policy mutations cannot add exclusions/u); assert.match(result.stdout, /unknown exclusion/u); } finally { write(join(root, testPath), source); } });
  check('removed maintained source-consumer route is rejected', () => { const path = join(root, 'tests/plugins/qualified-current-release/consumers.mjs'), bytes = readFileSync(path), text = bytes.toString(), needle = 'atomic-webdav-independent-source'; assert.equal(text.split(needle).length, 2); write(path, text.replace(needle, 'missing-independent-source')); try { const result = child('missing-route-mutant', [...testArgs, '--test-name-pattern=^approved captured-type classification', testPath]); assert.equal(result.status, 1); assert.equal(result.counts.fail, 1); assert.equal(result.counts.pass, 0); assert.match(result.stdout, /atomic-webdav-independent-source/u); } finally { write(path, bytes); } });
  const after = inventory(root); assert.deepEqual(after, before); report.sourceAndToolsUnchangedIncludingNewEntries = true; write(join(output, 'AFTER.json'), JSON.stringify(after, null, 2) + '\n');
} catch (error) { report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally { rmSync(temporary, { recursive: true, force: true }); report.cleaned = !existsSync(temporary); report.finishedAt = new Date().toISOString(); report.counts = { total: report.checks.length, pass: report.checks.filter(row => row.pass).length, fail: report.checks.filter(row => !row.pass).length }; write(join(output, 'RESULT.json'), JSON.stringify(report, null, 2) + '\n'); }
if (report.counts.fail) process.exitCode = 1;
console.log(JSON.stringify({ counts: report.counts, error: report.error, cleaned: report.cleaned }));
