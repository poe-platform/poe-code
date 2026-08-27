import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createTimeEnvCommands } from './dist/commands/time-env/index.js';
import { MemoryFileSystem } from './dist/fs/memory/index.js';

const rows = [];
const definition = createTimeEnvCommands().find(command => command.name === 'date');
async function virtual(args, zone) {
  const stdout = [], stderr = [];
  const result = await definition.execute({ command: 'date', args, env: { TZ: zone }, cwd: '/', fs: new MemoryFileSystem(),
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } } });
  return { status: result.exitCode, stdoutHex: Buffer.concat(stdout).toString('hex'), stderrHex: Buffer.concat(stderr).toString('hex') };
}
function native(binary, args, zone) {
  const result = spawnSync(binary, args, { cwd: process.env.TMPDIR, env: { LC_ALL: 'C', TZ: zone }, timeout: 3000, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error); assert.equal(result.signal, null);
  return { status: result.status, stdoutHex: result.stdout.toString('hex'), stderrHex: result.stderr.toString('hex') };
}
const flags = ['', '-', '_', '0', '^', '#', '#^', '^#', '1', '6', '9', '12', '_12', '012', '-12', '_012', '0_12', '^#30', '030'];
for (const instant of ['0008-01-02T03:04:05Z', '2024-02-29T15:06:07Z', '@-1']) {
  const epoch = native(`${process.env.GNU_DIR}/date`, ['-d', instant, '+%s'], 'UTC');
  assert.equal(epoch.status, 0);
  const seconds = Buffer.from(epoch.stdoutHex, 'hex').toString().trim();
  for (const zone of ['UTC', 'UTC-0:30:07', 'UTC+0:00:07', 'UTC-5:45', 'America/New_York', 'Europe/Paris']) {
    for (const [category, codes] of [['required-format', [...'aAbBhcpPrFDxRXTYy', 'z', ':z', '::z', ':::z']], ['zone-label-profile', ['Z']]]) {
      const format = codes.flatMap(code => flags.map(flag => `%${flag}${code}`)).join('|');
      const args = ['-d', instant, '+' + format], appleArgs = ['-r', seconds, '+' + format];
      const actual = await virtual(args, zone);
      const gnu = native(`${process.env.GNU_DIR}/date`, args, zone), apple = native('/bin/date', appleArgs, zone);
      rows.push({ category, args, appleArgs, env: { LC_ALL: 'C', TZ: zone }, actual, gnu, apple,
        gnuMatch: JSON.stringify(actual) === JSON.stringify(gnu), appleMatch: JSON.stringify(actual) === JSON.stringify(apple) });
    }
  }
}
await writeFile(`${process.env.REVIEW_OUTPUT}/fresh-native-matrix.json`, JSON.stringify({ versions: process.versions, rows }, null, 2) + '\n');
console.log(JSON.stringify({ rows: rows.length, GNU: rows.filter(row => row.gnuMatch).length, Apple: rows.filter(row => row.appleMatch).length,
  mismatches: rows.filter(row => !row.gnuMatch).map(row => ({ category: row.category, zone: row.env.TZ, instant: row.args[1] })) }, null, 2));
