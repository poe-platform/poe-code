import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Shell } from '../../src/shell/index.js';
import { MemoryFileSystem } from '../../src/fs/memory/index.js';
import { agentCommands } from '../../src/plugins/index.js';

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
