import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tableCases } from '../../table-text/cases.js';

const root = '/Users/kjopek/Workspace/safe-bash';
const work = '/tmp/safe-bash-comm-final-review-owned';
const oracle = join(root, 'tests/commands/metadata-stress/.oracle/coreutils-9.7');
const authorArgv0Directory = '/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src';
const digest = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const evidence = JSON.parse(await readFile(join(root, 'tests/commands/table-text/gnu-evidence.json'), 'utf8'));
const pins = JSON.parse(await readFile(join(root, 'tests/commands/table-text-stress/first-discrepancy.json'), 'utf8'));
assert.equal(tableCases.length, 216);
assert.equal(evidence.observations.length, 216);
const identities: Record<string, unknown> = {};
for (const command of ['paste', 'comm', 'join']) {
  const binary = join(oracle, 'src', command);
  const sha256 = digest(await readFile(binary));
  assert.equal(sha256, pins.identities[command].sha256);
  const version = spawnSync(binary, ['--version'], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, encoding: 'utf8', timeout: 5000 });
  assert.equal(version.status, 0);
  assert.equal(version.signal, null);
  assert.equal(version.stdout.split('\n')[0], `${command} (GNU coreutils) 9.7`);
  identities[command] = { binary, sha256, version: version.stdout, sourceSha256: digest(await readFile(join(oracle, 'src', command + '.c'))) };
}
const archiveSha256 = digest(await readFile(oracle + '.tar.xz'));
const manualSha256 = digest(await readFile(join(oracle, 'doc/coreutils.texi')));
assert.equal(archiveSha256, pins.archiveSha256);
assert.equal(manualSha256, pins.manualSha256);
await mkdir(work, { recursive: true });
const temporary = await mkdtemp(join(work, 'native216-'));
const observations = [];
try {
  for (const [index, fixture] of tableCases.entries()) {
    const cwd = join(temporary, String(index));
    await mkdir(cwd);
    await writeFile(join(cwd, 'review-sentinel'), 'comm-final-independent-native216');
    for (const [path, hex] of Object.entries(fixture.files)) {
      await mkdir(dirname(join(cwd, path)), { recursive: true });
      await writeFile(join(cwd, path), Buffer.from(hex, 'hex'));
    }
    const result = spawnSync(join(oracle, 'src', fixture.command), fixture.args, { argv0: join(authorArgv0Directory, fixture.command), cwd, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, input: Buffer.from(fixture.stdinHex, 'hex'), timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.error, undefined, fixture.name);
    assert.equal(result.signal, null, fixture.name);
    assert.notEqual(result.status, null, fixture.name);
    const row = { name: fixture.name, caseSha256: digest(JSON.stringify(fixture)), exitCode: result.status, stdoutHex: result.stdout.toString('hex'), stderrHex: result.stderr.toString('hex') };
    assert.deepEqual(row, evidence.observations[index], fixture.name);
    for (const [path, hex] of Object.entries(fixture.files)) assert.equal((await readFile(join(cwd, path))).toString('hex'), hex, fixture.name);
    assert.equal(await readFile(join(cwd, 'review-sentinel'), 'utf8'), 'comm-final-independent-native216');
    assert.deepEqual((await readdir(cwd)).sort(), [...Object.keys(fixture.files), 'review-sentinel'].sort());
    observations.push(row);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log(JSON.stringify({ phase: 'independent native-only, before final source freeze', at: new Date().toISOString(), inputCorpusSha256: digest(JSON.stringify(tableCases)), casesFileSha256: digest(await readFile(join(root, 'tests/commands/table-text/cases.ts'))), evidenceFileSha256: digest(await readFile(join(root, 'tests/commands/table-text/gnu-evidence.json'))), identities, authorArgv0Directory, archiveSha256, manualSha256, exact: observations.length, total: tableCases.length, observations, cleanup: { temporary, removed: true }, productExecuted: false }, null, 2));
