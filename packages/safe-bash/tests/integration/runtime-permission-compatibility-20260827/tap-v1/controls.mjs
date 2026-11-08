import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeConsumerPermission, consumerPermissionArgs } from '../../../../scripts/verify-current-consumers.mjs';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const output = resolve(process.argv[2]);
assert.ok(output.startsWith('/tmp/') && !existsSync(output));
const temporary = realpathSync(mkdtempSync('/tmp/safe-bash-tap-controls-'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const path = 'scripts/verify-current-consumers.mjs', source = readFileSync(join(repository, path), 'utf8');
const baseline = execFileSync('git', ['show', '774644f9:' + path], { cwd: repository, encoding: 'utf8' });
function loop(text) {
  const start = '      for (const runtime of group.runtime) {\n', end = '      }\n      assert.deepEqual(manifest(groupInstalled, "dist"), built);';
  assert.equal(text.split(start).length, 2); assert.equal(text.split(end).length, 2);
  return text.slice(text.indexOf(start) + start.length, text.indexOf(end));
}
const body = loop(source), oldBody = loop(baseline);
const countBlock = text => text.slice(text.indexOf('        let counts;'));
assert.equal(countBlock(body), countBlock(oldBody));
const executeLoop = new Function('group', 'runtime', 'permission', 'consumer', 'config', 'report', 'step', 'join', 'consumerPermissionArgs', 'environment', 'assert', 'result', body);
const report = { sourceSha256: digest(source), baseline: '774644f9', countBlockSha256: digest(countBlock(body)), profiles: [], controls: [], failures: [], fullGroupsExecuted: false };
const profiles = [
  { executable: '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node', version: 'v22.22.2', sha256: '5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011' },
  { executable: '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node', version: 'v24.11.1', sha256: '4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0' },
];
function check(name, action) {
  try { action(); report.controls.push({ name, status: 'pass' }); }
  catch (error) { report.controls.push({ name, status: 'fail' }); report.failures.push({ name, message: error.message, stack: error.stack }); }
}
try {
  for (const profile of profiles) {
    assert.equal(digest(readFileSync(profile.executable)), profile.sha256);
    const directory = join(temporary, profile.version), root = join(directory, 'source'), consumer = join(directory, 'consumer');
    mkdirSync(join(root, 'src'), { recursive: true }); mkdirSync(consumer);
    const forbidden = join(root, 'src/index.ts'); writeFileSync(forbidden, 'forbidden-source\n');
    const context = { root, directory }, permission = probeConsumerPermission(context, profile.executable);
    const record = { ...profile, permission, executions: [] }; report.profiles.push(record);
    const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' };
    function invoke(name, group, program, extension = '.mjs', wrongReporter = false) {
      const runtime = name + extension, filename = join(consumer, runtime), result = { runtimeResults: [] };
      writeFileSync(filename, program, { flag: 'wx' });
      const step = (_report, label, executable, originalArgs, cwd, extra) => {
        const args = wrongReporter ? originalArgs.map(arg => arg === '--test-reporter=tap' ? '--test-reporter=spec' : arg) : originalArgs;
        const run = spawnSync(executable, args, { cwd, encoding: 'utf8', timeout: 15000, ...extra });
        const execution = { label, executable, originalArgs, args, status: run.status, signal: run.signal, stdout: run.stdout, stderr: run.stderr, error: run.error?.message };
        record.executions.push(execution);
        assert.equal(run.error, undefined); assert.equal(run.signal, null); assert.equal(run.status, 0, run.stderr);
        return execution;
      };
      executeLoop(group, runtime, permission, consumer, { compilerOptions: { outDir: consumer } }, {}, step, join, consumerPermissionArgs, environment, assert, result);
      return result;
    }
    const fences = `assert.throws(()=>readFileSync(${JSON.stringify(forbidden)}),{code:'ERR_ACCESS_DENIED',permission:'FileSystemRead'}); assert.throws(()=>writeFileSync(${JSON.stringify(join(consumer, 'forbidden-write'))},'no'),{code:'ERR_ACCESS_DENIED',permission:'FileSystemWrite'});`;
    const tests = count => `import {test} from 'node:test'; import assert from 'node:assert/strict'; import {readFileSync,writeFileSync} from 'node:fs'; for(let index=0;index<${count};index++)test('actual-fenced-'+index,()=>{${fences}});`;
    for (const [name, group, count, extension] of [
      ['mandatory23', { name: 'webdav-timestamp-independent', nodeTests: 23 }, 23, '.mjs'],
      ['loopback13', { name: 'webdav-loopback' }, 13, '.mjs'],
      ['constructor', { name: 's3-constructor' }, 1, '.mjs'],
      ['suffix', { name: 'suffix-case' }, 2, '.test.mjs'],
    ]) check(profile.version + ': ' + name + ' explicit TAP/counts/fences', () => {
      const result = invoke(name, group, tests(count), extension);
      assert.deepEqual(result.runtimeResults[0].counts, { tests: count, pass: count, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
      const execution = record.executions.at(-1);
      assert.ok(execution.args.indexOf('--test-reporter=tap') < execution.args.length - 1);
      assert.deepEqual(execution.args.slice(0, 4), consumerPermissionArgs(permission, consumer, true));
      assert.equal(existsSync(join(consumer, 'forbidden-write')), false);
    });
    check(profile.version + ': plain non-node-test consumer keeps original argv', () => {
      const result = invoke('plain', { name: 'plain' }, `console.log('plain-body');`);
      assert.equal(result.runtimeResults[0].counts, undefined);
      assert.equal(record.executions.at(-1).args.includes('--test-reporter=tap'), false);
    });
    check(profile.version + ': actual spec reporter output is still rejected', () => {
      assert.throws(() => invoke('spec', { name: 'counted', nodeTests: 1 }, tests(1), '.mjs', true));
      assert.equal(record.executions.at(-1).status, 0);
      assert.match(record.executions.at(-1).stdout, /tests 1/);
    });
    check(profile.version + ': missing summary is rejected', () => { assert.throws(() => invoke('missing', { name: 'counted', nodeTests: 1 }, `console.log('no test summary');`)); });
    check(profile.version + ': zero count transport is rejected', () => { assert.throws(() => invoke('zero', { name: 'counted', nodeTests: 1 }, `console.log('# tests 0\\n# pass 0\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0');`)); });
    check(profile.version + ': mandatory23 cannot accept22', () => { assert.throws(() => invoke('wrong23', { name: 'counted', nodeTests: 23 }, tests(22))); });
    check(profile.version + ': loopback13 cannot accept12', () => { assert.throws(() => invoke('wrong13', { name: 'webdav-loopback' }, tests(12))); });
    check(profile.version + ': skipped real test is rejected', () => { assert.throws(() => invoke('skipped', { name: 'counted', nodeTests: 1 }, `import {test} from 'node:test'; test.skip('not-run',()=>{});`)); });
    check(profile.version + ': TODO real test is rejected', () => { assert.throws(() => invoke('todo', { name: 'counted', nodeTests: 1 }, `import {test} from 'node:test'; test.todo('not-run');`)); });
    assert.equal(digest(readFileSync(profile.executable)), profile.sha256);
  }
  assert.equal(digest(readFileSync(join(repository, path))), report.sourceSha256);
} catch (error) { report.failures.push({ message: error.message, stack: error.stack }); }
finally {
  rmSync(temporary, { recursive: true, force: true }); report.temporaryRemoved = !existsSync(temporary);
  report.status = report.failures.length ? 'author-controls-failed' : 'author-controls-pass-independent-review-pending';
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, controls: report.controls.length, failures: report.failures, temporaryRemoved: report.temporaryRemoved, output }));
  if (report.failures.length) process.exitCode = 1;
}
