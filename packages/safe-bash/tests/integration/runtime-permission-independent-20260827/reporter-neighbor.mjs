import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const output = resolve(process.argv[2] ?? ''); assert.ok(process.argv[2]); assert.equal(existsSync(output), false);
const temporary = realpathSync(mkdtempSync('/tmp/permission-reporter-neighbor-'));
const report = { runnerSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'), cases: [], sourceChanged: false, fullConsumerGroupsExecuted: false };
try {
  const allowed = join(temporary, 'consumer'), forbidden = join(temporary, 'source.ts'); mkdirSync(allowed); writeFileSync(forbidden, 'forbidden');
  const program = join(allowed, 'body.mjs');
  writeFileSync(program, `import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';test('body plus retained read/write fences',()=>{assert.throws(()=>readFileSync(${JSON.stringify(forbidden)}),{code:'ERR_ACCESS_DENIED',permission:'FileSystemRead'});assert.throws(()=>writeFileSync(${JSON.stringify(join(allowed, 'must-not-exist'))},'no'),{code:'ERR_ACCESS_DENIED',permission:'FileSystemWrite'});});\n`);
  for (const version of ['22.22.2', '24.11.1']) {
    const executable = `/Users/kjopek/.nvm/versions/node/v${version}/bin/node`;
    const sha256 = createHash('sha256').update(readFileSync(executable)).digest('hex');
    const args = ['--permission', '--allow-fs-read=' + allowed, '--allow-worker', '--unhandled-rejections=strict', '--test-reporter=tap', program];
    const result = spawnSync(executable, args, { cwd: allowed, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' }, encoding: 'utf8', timeout: 10000 });
    const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(name => [name, Number(result.stdout.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? NaN)]));
    report.cases.push({ executable, sha256, args, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr, counts });
    assert.equal(result.status, 0); assert.equal(result.signal, null); assert.equal(result.error, undefined);
    assert.deepEqual(counts, { tests: 1, pass: 1, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
    assert.equal(existsSync(join(allowed, 'must-not-exist')), false);
  }
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally { rmSync(temporary, { recursive: true, force: true }); report.cleaned = !existsSync(temporary); writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); }
console.log(JSON.stringify({ cases: report.cases.length, error: report.error, cleaned: report.cleaned }));
