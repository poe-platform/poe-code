import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { run } from '../helpers.ts';

const own = dirname(import.meta.filename), repo = resolve(own, '../../../..');
const output = process.argv[2] ?? 'native-v1.json'; assert.match(output, /^[a-z0-9-]+\.json$/);
const scratch = await mkdtemp('/tmp/time-env-fraction-native-');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const binary = join(repo, 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src/date');
const binaryHash = hash(await readFile(binary)); assert.equal(binaryHash, '14c1c04f8a1e859e9421993856ba1d29f49dc750d91be5dd299841f970f31f44');
const report = { capturedAt: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim(), versions: process.versions,
  binary: { sha256: binaryHash, version: execFileSync(binary, ['--version'], { env: { LC_ALL: 'C' } }).toString() }, appleSha256: hash(await readFile('/bin/date')), sourceHashes: {}, rows: [] };
for (const name of ['calendar', 'format', 'date', 'shared', 'sleep', 'printenv', 'index']) report.sourceHashes[name] = hash(await readFile(join(repo, `src/commands/time-env/${name}.ts`)));
function native(path, args, zone) {
  const result = spawnSync(path, args, { cwd: scratch, env: { LC_ALL: 'C', TZ: zone, HOME: scratch, TMPDIR: scratch }, timeout: 3000, maxBuffer: 1024 * 1024 });
  assert.ifError(result.error); assert.equal(result.signal, null); assert.notEqual(result.status, null);
  return { status: result.status, stdoutHex: result.stdout.toString('hex'), stderrHex: result.stderr.toString('hex') };
}
async function capture(category, input, directives, zone = 'UTC') {
  const args = ['-d', input, '+' + directives.join('|')], gnu = native(binary, args, zone);
  assert.equal(gnu.status, 0, JSON.stringify({ args, gnu }));
  const epoch = native(binary, ['-d', input, '+%s'], zone); assert.equal(epoch.status, 0);
  const appleArgs = ['-r', Buffer.from(epoch.stdoutHex, 'hex').toString().trim(), args[2]];
  const apple = native('/bin/date', appleArgs, zone);
  const observed = await run('date', args, {}, { env: { TZ: zone } });
  const virtual = { status: observed.exitCode, stdoutHex: observed.stdoutHex, stderrHex: Buffer.from(observed.stderr).toString('hex') };
  report.rows.push({ category, input, zone, directives, args, gnu, appleArgs, apple, virtual,
    gnuMatch: JSON.stringify(virtual) === JSON.stringify(gnu), appleMatch: JSON.stringify(virtual) === JSON.stringify(apple) });
}
try {
  const widths = ['', '1', '2', '3', '6', '8', '9', '10', '17', '31'];
  const flags = ['', '-', '_', '0', '^', '#', '^#', '^^#', '_0', '0_', '-_', '_-', '0-'];
  const formats = [...new Set(flags.flatMap(flag => widths.map(width => `%${flag}${width}N`)))].filter(format => format !== '%-N');
  for (const input of ['@0', '@0.100000000', '@0.000000001', '@0.000000100', '@0.001200000', '@0.123456789', '@0.999999999', '@-0.000000001', '@-0.123456789', '@-1.000000001', '@1704164645.123000000', '@1704164645.000001000']) {
    await capture('required-fraction-v1', input, formats);
    await capture('host-resolution-bare-N-profile', input, ['%s', '%N', '%-N', '%--N', '%3N', '%6N', '%9N']);
  }
  for (const input of ['0000-01-01T12:00:00Z', '0000-01-02T12:00:00Z', '0000-01-03T12:00:00Z', '0000-12-31T12:00:00Z', '0001-01-01T12:00:00Z',
    '0004-01-01T12:00:00Z', '0099-01-01T12:00:00Z', '0099-12-31T12:00:00Z', '0100-01-01T12:00:00Z', '0100-01-04T12:00:00Z',
    '1899-12-31T12:00:00Z', '1900-01-01T12:00:00Z', '1999-01-01T12:00:00Z', '2000-01-01T12:00:00Z', '2021-01-01T12:00:00Z']) {
    for (const zone of ['UTC', 'UTC-14']) await capture('required-ISO-year-v1', input, ['%Y', '%y', '%G', '%g', '%V', '%u', '%-g', '%_g', '%03g', '%_7g', '%-7g', '%07G'], zone);
  }
  for (const input of ['@-62167219201', '@-62198755200', '@-63113904000']) await capture('native-negative-year-outside-product-domain', input, ['%Y', '%y', '%G', '%g', '%V']);
  for (const [name, expected] of Object.entries(report.sourceHashes)) assert.equal(hash(await readFile(join(repo, `src/commands/time-env/${name}.ts`))), expected, name);
  const archive = join(repo, 'tests/commands/metadata-stress/.oracle/coreutils-9.7.tar.xz');
  report.primaryArchiveSha256 = hash(await readFile(archive)); assert.equal(report.primaryArchiveSha256, 'e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf');
  report.primarySources = {};
  for (const path of ['lib/strftime.c', 'src/date.c', 'doc/coreutils.texi']) report.primarySources[path] = hash(execFileSync('/usr/bin/tar', ['-xOf', archive, 'coreutils-9.7/' + path], { maxBuffer: 4 * 1024 * 1024 }));
  report.finishedAt = new Date().toISOString(); report.cleaned = true;
  const encoded = JSON.stringify(report, null, 2) + '\n';
  const patch = `*** Begin Patch\n*** Add File: ${join(own, output)}\n${encoded.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`;
  const patchFile = join(scratch, 'capture.patch'); await writeFile(patchFile, patch); const handle = await open(patchFile, 'r');
  try { const result = spawnSync('apply_patch', [], { cwd: repo, stdio: [handle.fd, 'pipe', 'pipe'] }); assert.equal(result.status, 0, result.stderr?.toString()); }
  finally { await handle.close(); }
  console.log(JSON.stringify({ rows: report.rows.length, groups: Object.fromEntries([...new Set(report.rows.map(row => row.category))].map(category => {
    const rows = report.rows.filter(row => row.category === category); return [category, { total: rows.length, gnuMatches: rows.filter(row => row.gnuMatch).length }];
  })) }));
} finally { await rm(scratch, { recursive: true, force: true }); }
