import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('./', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const frozen = JSON.parse(readFileSync(join(here, 'FREEZE.json')));
for (const [name, digest] of Object.entries(frozen.files)) assert.equal(hash(readFileSync(join(here, name))), digest);
const cases = JSON.parse(readFileSync(join(here, 'cases.frozen.json')));
const base = '/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX';
const tree = join(base, 'coreutils-9.7');
const binary = join(tree, 'src/date');
const archive = join(base, 'coreutils-9.7.tar.xz');
const temporary = mkdtempSync('/tmp/fraction-semantics-native-');
const raw = [];
const command = (program, args, zone = 'UTC0', maxBuffer = 4 * 1024 * 1024) => {
  const started = performance.now();
  const result = spawnSync(program, args, { cwd: temporary, env: { LC_ALL: 'C', TZ: zone }, timeout: 3000, maxBuffer });
  return { program, args, env: { LC_ALL: 'C', TZ: zone }, status: result.status, signal: result.signal,
    stdoutHex: result.stdout?.toString('hex') ?? '', stderrHex: result.stderr?.toString('hex') ?? '',
    error: result.error ? { code: result.error.code, message: result.error.message } : null, milliseconds: performance.now() - started };
};
const text = result => Buffer.from(result.stdoutHex, 'hex').toString();
try {
  assert.equal(hash(readFileSync(archive)), 'e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf');
  const sources = ['src/date.c', 'lib/strftime.c', 'lib/gettime-res.c', 'src/show-date.c', 'doc/coreutils.texi'].map(path => {
    const result = command('/usr/bin/tar', ['-xOf', archive, 'coreutils-9.7/' + path]);
    assert.equal(result.status, 0);
    const archiveHash = hash(Buffer.from(result.stdoutHex, 'hex'));
    const localHash = hash(readFileSync(join(tree, path)));
    assert.equal(localHash, archiveHash, path);
    return { path, archiveHash, localHash, matchesOfficialArchive: true };
  });
  const version = command(binary, ['--version']);
  assert.match(text(version), /^date \(GNU coreutils\) 9\.7\n/);
  const profile = { capturedAt: new Date().toISOString(), identity: cases.identity, casesSha256: hash(readFileSync(join(here, 'cases.frozen.json'))),
    binary, binarySha256: hash(readFileSync(binary)), authorBinarySha256: '14c1c04f8a1e859e9421993856ba1d29f49dc750d91be5dd299841f970f31f44',
    archive, archiveSha256: hash(readFileSync(archive)), sources, version, resolution: command(binary, ['--resolution']),
    uname: command('/usr/bin/uname', ['-a']), dylibs: command('/usr/bin/otool', ['-L', binary]),
    configSha256: hash(readFileSync(join(tree, 'lib/config.h'))), configLogSha256: hash(readFileSync(join(tree, 'config.log'))),
    node: process.version, versions: process.versions, env: { LC_ALL: 'C', TZ: 'per-row' }, cwd: temporary,
    deadlinePerInvocationMs: 3000, maxBufferBytes: 4 * 1024 * 1024, noClockSetting: true,
    claim: 'Existing independently hashed GNU9.7 Darwin arm64 binary; matching release source members, not a reproducible-build equivalence claim.' };
  writeFileSync(join(here, 'native-profile.json'), JSON.stringify(profile, null, 2) + '\n', { flag: 'wx' });
  for (const row of [...cases.proof, ...cases.product.filter(row => row.native !== false)]) {
    assert.equal(row.args[0], '-d');
    const result = command(binary, row.args, row.zone);
    const actual = text(result);
    const record = { id: row.id, category: row.category, ...result,
      sourceBranchMatch: row.sourceBranchText === undefined ? null : result.status === 0 && actual === row.sourceBranchText && result.stderrHex === '',
      magnitudeMatch: row.magnitudeText === undefined ? null : result.status === 0 && actual === row.magnitudeText && result.stderrHex === '' };
    raw.push(record);
    if (record.magnitudeMatch === false && !raw.slice(0, -1).some(previous => previous.magnitudeMatch === false)) {
      const report = `Independent semantics finding (native/source proof, NOT a supported-domain product bug):\nPinned product ${cases.commit}, format.ts ${cases.formatHash}.\nGNU9.7 Darwin ${profile.binarySha256}.\nargv=${JSON.stringify(row.args)} env=LC_ALL=C,TZ=${row.zone}\ncalendar=${JSON.stringify(row.calendar)} native=${JSON.stringify(actual)} abs(ISOyear%100)=${JSON.stringify(row.magnitudeText)} sourceBranch=${JSON.stringify(row.sourceBranchText)}\nThe author's unrestricted general magnitude claim is false at negative-century next-ISO-year boundaries. Native proof classification continues only over the already frozen bounded cases. Source remains readonly; ROOT should route this to Curie.\n`;
      writeFileSync('/tmp/safe-bash-fraction-independent-semantics-progress.txt', report);
      console.log(report);
    }
  }
  writeFileSync(join(here, 'native-results.jsonl'), raw.map(row => JSON.stringify(row)).join('\n') + '\n', { flag: 'wx' });
  const proof = raw.filter(row => row.category === 'negative-year-primary-proof');
  const summary = { rows: raw.length, proofRows: proof.length, sourceBranchMatches: proof.filter(row => row.sourceBranchMatch).length,
    magnitudeMatches: proof.filter(row => row.magnitudeMatch).length, magnitudeFailures: proof.filter(row => !row.magnitudeMatch).map(row => row.id),
    processErrors: raw.filter(row => row.error || row.signal).length, rawSha256: hash(readFileSync(join(here, 'native-results.jsonl'))) };
  writeFileSync(join(here, 'native-summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(summary));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
