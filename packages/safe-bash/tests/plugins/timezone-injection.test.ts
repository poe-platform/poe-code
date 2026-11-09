import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { Shell } from '../../src/shell/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';
import { agentCommands } from '../../src/plugins/index.js';

for (const [tz, expected] of [
  ['IST-5:30', '1970-01-01 05:30:00 +0530 IST'],
  ['FOO3', '1969-12-31 21:00:00 -0300 FOO'],
  ['FOO+3:15', '1969-12-31 20:45:00 -0315 FOO'],
  ['FOO-0:45', '1970-01-01 00:45:00 +0045 FOO'],
  ['FOO0', '1970-01-01 00:00:00 +0000 FOO'],
  ['foo-1:02:03', '1970-01-01 01:02:03 +0102 foo'],
  ['<+0530>-5:30', '1970-01-01 05:30:00 +0530 +0530'],
  [':IST-5:30', '1970-01-01 05:30:00 +0530 IST'],
  ['UTC0', '1970-01-01 00:00:00 +0000 UTC'],
  ['UTC+03:30', '1969-12-31 20:30:00 -0330 UTC'],
  ['GMT-2', '1970-01-01 02:00:00 +0200 GMT'],
] as const) {
  test(`fixed-offset TZ preserves POSIX signs and abbreviations: ${tz}`, async () => {
    const script = `export TZ='${tz}'
printf -v stamp '%(%F %T %z %Z)T' 0
rc=$?
printf '%s:<%s>\\n' "$rc" "$stamp"
printf '%(%F %T %z %Z)T\\n' 0`;
    const oracle = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', script], {
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, encoding: 'utf8', timeout: 2000,
    });
    assert.ifError(oracle.error);
    assert.equal(oracle.status, 0);
    assert.equal(oracle.stderr, '');
    assert.equal(oracle.stdout, `0:<${expected}>\n${expected}\n`);
    const hostTimeZone = process.env.TZ;
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
    try {
      const result = await shell.exec(script);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, oracle.stdout);
      const date = await shell.exec(`TZ='${tz}' date -d @0 +"%F %T %z %Z"`);
      assert.equal(date.exitCode, 0);
      assert.equal(date.stderr, '');
      assert.equal(date.stdout, `${expected}\n`);
      assert.equal(process.env.TZ, hostTimeZone);
    } finally { await shell.dispose(); }
  });
}

test('public agent configuration injects a default timezone without changing the host', async () => {
  const hostTimeZone = process.env.TZ;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands({
    timeEnv: { clock: () => Date.UTC(2026, 8, 16, 19, 40, 48), defaultTimeZone: 'America/New_York' },
  }));
  try {
    assert.equal((await shell.exec('date')).stdout, 'Wed Sep 16 15:40:48 EDT 2026\n');
    assert.equal((await shell.exec('date -u')).stdout, 'Wed Sep 16 19:40:48 UTC 2026\n');
    assert.equal((await shell.exec('TZ=Asia/Kolkata date +"%F %T %z"')).stdout, '2026-09-17 01:10:48 +0530\n');
    assert.equal((await shell.exec('date +%z')).stdout, '-0400\n');
    assert.equal((await shell.exec('date -d 2026-01-15T12:00:00Z +"%T %z"')).stdout, '07:00:00 -0500\n');
    assert.equal(process.env.TZ, hostTimeZone);
  } finally { await shell.dispose(); }
});

test('virtual shell TZ overrides the configured default and stays isolated between shells', async () => {
  const options = { timeEnv: { clock: () => 0, defaultTimeZone: 'America/New_York' } };
  const east = new Shell({ fs: new MemoryFileSystem(), env: { TZ: 'Asia/Tokyo' } }).use(agentCommands(options));
  const west = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands(options));
  try {
    const [eastern, western] = await Promise.all([east.exec('date +"%F %T %z"'), west.exec('date +"%F %T %z"')]);
    assert.equal(eastern.stdout, '1970-01-01 09:00:00 +0900\n');
    assert.equal(western.stdout, '1969-12-31 19:00:00 -0500\n');
    assert.equal((await east.exec('TZ= date +%z')).stdout, '+0000\n');
    const invalid = await east.exec('TZ=Not/A_Zone date');
    assert.equal(invalid.exitCode, 1);
    assert.ok(invalid.stderr.includes('unsupported virtual TZ'));
    assert.equal((await east.exec('date +%z')).stdout, '+0900\n');
  } finally { await Promise.all([east.dispose(), west.dispose()]); }
});
