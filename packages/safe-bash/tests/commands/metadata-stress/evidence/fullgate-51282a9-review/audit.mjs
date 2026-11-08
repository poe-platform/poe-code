import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { git, hash, save } from '../../../diff-patch-stress/evidence/fullgate-51282a9-review/replay.mjs';

const directory = 'tests/commands/metadata-stress/evidence/fullgate-51282a9-review';
const historical = JSON.parse(git('show', '72f780d:tests/commands/metadata-stress/oracle-evidence.json'));
const table = JSON.parse(git('show', '72f780d:tests/commands/table-text-stress/first-discrepancy.json'));
const oracle = resolve('tests/commands/metadata-stress/.oracle/coreutils-9.7');
const archive = `${oracle}.tar.xz`;
const pins = [
  { path: archive, expected: historical.archiveSha256 },
  ...Object.entries(historical.nativeSources).map(([path, expected]) => ({ path: `${oracle}/${path}`, expected, member: `coreutils-9.7/${path}` })),
  { path: `${oracle}/doc/coreutils.texi`, expected: table.manualSha256, member: 'coreutils-9.7/doc/coreutils.texi' },
  ...Object.entries(historical.binaries).map(([command, expected]) => ({ path: `${oracle}/src/${command}`, expected, version: `${command} (GNU coreutils) 9.7` })),
  ...Object.entries(table.identities).map(([command, identity]) => ({ path: `${oracle}/src/${command}`, expected: identity.sha256, version: `${command} (GNU coreutils) 9.7` })),
  { path: `${oracle}/src/touch`, expected: '47fc9af399d94e27bc94c19eba754502b38dfb80fbad3d09c5f6b237698dbf68', version: 'touch (GNU coreutils) 9.7' },
  { path: '/private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src/stat', expected: 'bf6f8514f2a220a3c3743154e0530baeec864b9d1f20315cd9cb5832d28c9860', version: 'stat (GNU coreutils) 9.7' },
];
const native = pins.map(pin => {
  try {
    const actual = hash(readFileSync(pin.path));
    const sourceArchiveSha256 = pin.member ? hash(execFileSync('/usr/bin/tar', ['-xOf', archive, pin.member])) : undefined;
    const version = pin.version ? spawnSync(pin.path, ['--version'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, timeout: 3000 }) : undefined;
    return { ...pin, actual, sourceArchiveSha256, version: version ? { status: version.status, stdout: version.stdout, stderr: version.stderr, signal: version.signal } : undefined, matches: actual === pin.expected && (!pin.member || sourceArchiveSha256 === pin.expected) && (!pin.version || version.status === 0 && version.stdout.split('\n')[0] === pin.version) };
  } catch (error) { return { ...pin, unavailable: error.message, matches: false }; }
});
const authors = Object.entries(historical.authorFilesSha256).map(([name, expected]) => {
  const path = `tests/commands/metadata/${name}`;
  const blob = git('rev-parse', `${historical.initialHead}:${path}`).toString().trim();
  const original = hash(git('cat-file', 'blob', blob));
  const checkpoint = hash(git('show', `72f780d:${path}`));
  return { path, expected, originalCommit: historical.initialHead, blob, original, checkpoint, historicalMatches: original === expected, checkpointMatches: checkpoint === expected };
});
const controls = [
  { name: 'current stat test cannot authenticate historical test', rejected: authors.find(row => row.path.endsWith('/stat.test.ts')).checkpointMatches === false },
  { name: 'wrong historical blob', rejected: hash(git('cat-file', 'blob', authors[0].blob)) !== authors[1].expected },
  { name: 'wrong oracle binary', rejected: hash(readFileSync(`${oracle}/src/chmod`)) !== historical.binaries.stat },
];
assert(native.every(row => row.matches));
assert(authors.every(row => row.historicalMatches));
assert(controls.every(row => row.rejected));
save(`${directory}/initial-authentication.json`, { capturedAt: new Date().toISOString(), qualification: 'Existing pinned GNU coreutils9.7 Darwin arm64 artifacts; archive member crosschecks, not Linux or signature verification; controls not added to coverage', native, authors, controls });
console.log({ nativeAssets: native.length, historicalAuthors: authors.length, controls: controls.length });
