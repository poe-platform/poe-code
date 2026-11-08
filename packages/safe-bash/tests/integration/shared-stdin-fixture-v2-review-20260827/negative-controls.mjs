import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const output = resolve(process.argv[2]); assert.ok(output.startsWith('/tmp/shared-stdin-fixture-v2-') && !existsSync(output)); mkdirSync(output);
const replay = '/tmp/shared-stdin-fixture-v2-independent-curie-01';
const authentication = JSON.parse(readFileSync(join(replay, 'authentication.json')));
const fixture = '8e5fec07ec9a39582987736269bbed51caeb795e', base = 'tests/integration/shared-external-stdin-independent-20260827/fixture-v2/';
const runtime = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = (commit, path) => execFileSync('git', ['--no-replace-objects', 'show', commit + ':' + path], { cwd: repository });
const temporary = realpathSync(mkdtempSync('/tmp/shared-stdin-fixture-v2-negative-work-'));
const consumer = join(temporary, 'consumer'), fixtures = join(consumer, 'fixtures'), packageRoot = join(consumer, 'node_modules/virtual-bash');
const report = { candidate: authentication.candidate, fixture, controls: [], commands: [], failures: [], sourceMutants: 0, packageCopy: 'Regular-file copy of independently replayed authenticated f881 npm package' };
function snapshot(root) {
  const rows = [];
  function visit(local) {
    const path = join(root, local), stat = lstatSync(path); assert.equal(stat.isSymbolicLink(), false);
    if (stat.isDirectory()) { rows.push({ path: local || '.', kind: 'directory', mode: stat.mode & 0o777 }); for (const name of readdirSync(path).sort()) visit(local ? local + '/' + name : name); }
    else { assert.equal(stat.isFile(), true); const bytes = readFileSync(path); rows.push({ path: local, kind: 'file', mode: stat.mode & 0o777, size: bytes.length, sha256: hash(bytes) }); }
  }
  visit(''); return rows;
}
function replaceOnce(text, before, after) { assert.equal(text.split(before).length, 2); return text.replace(before, after); }
function execute(label, script, args) {
  const target = join(output, label + '.json'), loads = join(output, label + '.loads.jsonl');
  const argv = ['--unhandled-rejections=strict', '--experimental-loader', join(fixtures, 'loader.mjs'), join(fixtures, script), ...args, target];
  const child = spawnSync(runtime, argv, { cwd: consumer, encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', NODE_OPTIONS: '', INDEPENDENT_ALLOWED_ROOTS: JSON.stringify([fixtures, packageRoot]), INDEPENDENT_LOAD_RECEIPT: loads } });
  const record = { label, executable: runtime, argv, cwd: consumer, pid: child.pid, status: child.status, signal: child.signal, error: child.error?.message, stdout: child.stdout, stderr: child.stderr };
  report.commands.push(record); assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 1);
  const records = readFileSync(loads, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  for (const load of records) { const entry = report.consumerBefore.find(row => row.path === relative(consumer, load.filename)); assert.equal(load.sha256, entry?.sha256, load.filename); }
  assert.ok(records.some(load => load.filename === join(packageRoot, 'dist/shell/input.js') && load.sha256 === 'f8b984b6fc338ff3d1ca60e10283ab100d8e62a697f4b7f8e691819c28ea7c4a'));
  report.loadedReceipts = (report.loadedReceipts ?? 0) + records.length;
  return JSON.parse(readFileSync(target));
}
try {
  assert.equal(hash(readFileSync(runtime)), '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
  mkdirSync(fixtures, { recursive: true }); cpSync(join(authentication.consumer, 'node_modules/virtual-bash'), packageRoot, { recursive: true, force: false, errorOnExist: true });
  const expectedPackage = authentication.consumerBefore.filter(row => row.path === 'node_modules/virtual-bash' || row.path.startsWith('node_modules/virtual-bash/')).map(row => ({ ...row, path: row.path === 'node_modules/virtual-bash' ? '.' : row.path.slice('node_modules/virtual-bash/'.length) }));
  assert.deepEqual(snapshot(packageRoot), expectedPackage);
  for (const name of ['cases.mjs', 'loader.mjs']) writeFileSync(join(fixtures, name), blob(fixture, base + name));
  const probe = blob(fixture, base + 'probe.mjs').toString();
  const primary = replaceOnce(probe, '    assert.equal(actual.ok, true, "ordinary primary read failure fulfills");\n    assert.equal(actual.value.exitCode, 1);', '    assert.equal(actual.ok, true, "ordinary primary read failure fulfills");\n    assert.equal(actual.value.exitCode, 0);');
  writeFileSync(join(fixtures, 'probe-status0.mjs'), primary);
  const column = blob(fixture, base + 'column-close.mjs').toString();
  const oldColumn = blob('79f0f91717a4e3df328981c7d4988b129c417706', 'tests/integration/shared-external-stdin-independent-20260827/candidate-review/column-close.mjs');
  assert.equal(replaceOnce(column, '"column: EFBIG: column input limit exceeded\\n"', '"column: input limit exceeded\\n"'), oldColumn.toString());
  writeFileSync(join(fixtures, 'column-original.mjs'), oldColumn);
  writeFileSync(join(fixtures, 'column-status0.mjs'), replaceOnce(column, '        assert.equal(result.value.exitCode, 1);', '        assert.equal(result.value.exitCode, 0);'));
  report.consumerBefore = snapshot(consumer);
  for (const mode of ['zero', 'error']) {
    const result = execute('primary-status0-' + mode, 'probe-status0.mjs', ['shell-primary-read-' + mode]);
    assert.equal(result.pass, false); assert.equal(result.failure.name, 'AssertionError'); assert.match(result.failure.message, /1 !== 0/);
    assert.ok(result.failure.stack.includes('probe-status0.mjs:128:'));
    assert.equal(result.stderr.join(''), 'shell: line 1: ' + (mode === 'zero' ? '0' : 'independent-primary-failure') + '\n');
    assert.equal(result.input.reads, 1); assert.equal(result.input.returns, 1); assert.deepEqual(result.output, []);
    report.controls.push({ name: 'primary-' + mode + '-must-remain-status1', detectedRows: 1, status: 'pass' });
  }
  const original = execute('column-original-prefix', 'column-original.mjs', [packageRoot]);
  assert.equal(original.rows.length, 6);
  for (const row of original.rows) {
    assert.equal(row.pass, false); assert.ok(row.failure.stack.includes('column-original.mjs:33:'));
    assert.equal(row.observed.stderr, 'column: EFBIG: column input limit exceeded\n'); assert.equal(row.observed.reads, 1); assert.equal(row.observed.returns, 1); assert.equal(row.observed.stdoutHex, '');
  }
  report.controls.push({ name: 'original-column-prefix-still-fails-all6-on-same-inputs', detectedRows: 6, status: 'pass' });
  const status = execute('column-direct-status0', 'column-status0.mjs', [packageRoot]);
  assert.equal(status.rows.length, 6);
  for (const row of status.rows) {
    assert.equal(row.observed.stderr, 'column: EFBIG: column input limit exceeded\n'); assert.equal(row.observed.reads, 1); assert.equal(row.observed.returns, 1); assert.equal(row.observed.stdoutHex, '');
    if (row.boundary === 'direct') { assert.equal(row.pass, false); assert.equal(row.observed.ok, true); assert.equal(row.observed.exitCode, 1); assert.match(row.failure.message, /1 !== 0/); }
    else { assert.equal(row.pass, true); assert.equal(row.observed.ok, false); assert.equal(row.observed.sameReturnReason, true); }
  }
  report.controls.push({ name: 'column-direct-status1-and-shell-reason-identity-remain-distinct', detectedRows: 3, unchangedPassingRows: 3, status: 'pass' });
  report.consumerAfter = snapshot(consumer); assert.deepEqual(report.consumerAfter, report.consumerBefore);
  assert.equal(hash(readFileSync(runtime)), '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011');
  report.status = 'independent-negative-controls-pass';
} catch (error) { report.status = 'independent-negative-controls-failed'; report.failures.push({ message: error.message, stack: error.stack }); process.exitCode = 1; }
finally {
  rmSync(temporary, { recursive: true, force: true }); report.temporaryRemoved = !existsSync(temporary);
  writeFileSync(join(output, 'RESULT.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, controls: report.controls, failures: report.failures, commands: report.commands.length, temporaryRemoved: report.temporaryRemoved, output }));
}
