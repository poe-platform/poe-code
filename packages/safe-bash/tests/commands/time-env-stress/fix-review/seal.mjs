import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const own = dirname(import.meta.filename), repo = resolve(own, '../../../..'), target = join(own, 'evidence');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path));
const artifacts = [];
const base = 'd904ca986fa945df8aef6e11b4165e2c2a63f814', fixed = '94bb4c974b17cd01477eff1c92e41619e0ebf465';
const names = ['flag %12F', 'flag %#c', 'flag %-z', 'flag %_z', 'flag %_12z', 'flag %^P', 'sleep exact total 0.0009999999 0.0000000001', 'sleep exact total 0.0004999999 0.0005000001'];
const captures = [
  ['unchanged-before', '/tmp/safe-bash-time-env-rereview-before-20260827', 'manifest-after.json'],
  ['unchanged-after', '/tmp/safe-bash-time-env-rereview-after-20260827', 'manifest-after.json'],
  ['packed-import-guard-attempt', '/tmp/safe-bash-time-env-rereview-packed-20260827', 'manifest.json'],
  ['packed-mixed-N-attempt', '/tmp/safe-bash-time-env-rereview-packed-corrected-20260827', 'manifest.json'],
  ['packed-separated-tsx', '/tmp/safe-bash-time-env-rereview-packed-final-20260827', 'manifest.json'],
  ['packed-compiled-before', '/tmp/safe-bash-time-env-rereview-packed-compiled-before-20260827', 'manifest.json'],
  ['packed-compiled-after', '/tmp/safe-bash-time-env-rereview-packed-compiled-after-20260827', 'manifest.json'],
];
async function add(path, bytes) {
  const text = bytes.toString().replace(/\n?$/, '\n');
  const temporary = await mkdtemp('/tmp/time-env-review-seal-');
  try {
    const patch = `*** Begin Patch\n*** Add File: ${join(target, path)}\n${text.split('\n').slice(0, -1).map(line => '+' + line).join('\n')}\n*** End Patch\n`;
    const input = join(temporary, 'input.patch'); await writeFile(input, patch);
    const handle = await open(input, 'r');
    try { const result = spawnSync('apply_patch', [], { cwd: repo, stdio: [handle.fd, 'pipe', 'pipe'], maxBuffer: 1024 * 1024 }); assert.equal(result.status, 0, result.stderr?.toString()); }
    finally { await handle.close(); }
  } finally { await rm(temporary, { recursive: true, force: true }); }
  const digest = hash(await readFile(join(target, path)));
  artifacts.push({ path, sha256: digest }); return digest;
}
async function archive(label, directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    assert.ok(entry.isFile(), entry.name);
    const bytes = await readFile(join(directory, entry.name));
    const encoded = entry.name.endsWith('.json') ? Buffer.from(JSON.stringify(JSON.parse(bytes)) + '\n') : bytes;
    const path = `${label}/${entry.name}`; await add(path, encoded);
    Object.assign(artifacts.at(-1), { capturedSha256: hash(bytes), capturedBytes: bytes.length, transformation: entry.name.endsWith('.json') ? 'lossless JSON compaction' : 'terminal newline normalization' });
  }
}
if (process.argv.includes('--check')) {
  for (const entry of await json(join(target, 'ARTIFACTS.json'))) assert.equal(hash(await readFile(join(target, entry.path))), entry.sha256, entry.path);
  const checkpoint = await json(join(target, 'CHECKPOINT.json'));
  for (const [path, expected] of Object.entries(checkpoint.reviewerInputs)) assert.equal(hash(await readFile(join(own, path))), expected, path);
  console.log('sealed rereview inputs and captures verified');
} else {
  const checkpoint = { capturedAt: new Date().toISOString(), base, fixed, originalEightAccepted: true, fullDateAcceptance: false, defaultIntegration: false, publicLeafExport: false, wholeProductAcceptance: false, captures: [], reviewerInputs: {} };
  const original = JSON.parse(execFileSync('git', ['show', '75d4e0c:tests/commands/time-env-stress/evidence/CHECKPOINT.json'], { cwd: repo, maxBuffer: 8 * 1024 * 1024 }));
  for (const [label, directory, manifestName] of captures) {
    const manifest = await json(join(directory, manifestName));
    assert.equal(manifest.cleaned, true); assert.equal(manifest.inputsUnchanged, true);
    await assert.rejects(access(manifest.scratch), error => error.code === 'ENOENT');
    for (const command of Object.values(manifest.commands)) { assert.deepEqual(command.survivors, []); assert.equal(command.timedOut, false); assert.equal(command.outputExceeded, false); }
    const capture = { label, source: manifest.source, candidate: manifest.candidate, startedAt: manifest.startedAt, finishedAt: manifest.finishedAt, commands: Object.fromEntries(Object.entries(manifest.commands).map(([name, result]) => [name, { status: result.status, counts: result.counts }])), cleaned: true };
    if (label.startsWith('unchanged-')) {
      assert.equal(manifest.archiveSha256, original.archiveSha256);
      assert.equal(manifest.reviewerInputs['consumer.mts'], original.reviewerInputs['consumer.mts']);
      assert.equal(manifest.reviewerInputs['guard.mjs'], original.reviewerInputs['guard.mjs']);
      assert.equal(manifest.commands['unchanged-author'].counts.pass, 223);
      assert.equal(manifest.commands['author-types'].status, 0); assert.equal(manifest.commands.build.status, 0); assert.equal(manifest.commands['consumer-types'].status, 0);
      const result = await json(join(directory, 'holdouts.json'));
      capture.total = result.rows.length; capture.pass = result.rows.filter(row => row.result === 'pass').length; capture.fail = result.rows.filter(row => row.result === 'fail').length;
      assert.equal(capture.total, 305); assert.equal(capture.pass, label.endsWith('before') ? 296 : 304);
      const productFailures = result.rows.filter(row => row.result === 'fail' && row.category !== 'Apple-BSD-observed-not-target');
      assert.deepEqual(productFailures.map(row => row.name), label.endsWith('before') ? names : []);
      capture.originalEight = result.rows.filter(row => names.includes(row.name));
      capture.profileDisagreements = result.rows.filter(row => row.category === 'Apple-BSD-observed-not-target');
      const matrix = await json(join(directory, 'fresh-native-matrix.json'));
      capture.nativeMatrix = { total: matrix.rows.length, GNU: matrix.rows.filter(row => row.gnuMatch).length, Apple: matrix.rows.filter(row => row.appleMatch).length };
      if (label.endsWith('after')) {
        checkpoint.ICULabelDisagreements = matrix.rows.filter(row => !row.gnuMatch);
        assert.equal(checkpoint.ICULabelDisagreements.length, 5); assert.ok(checkpoint.ICULabelDisagreements.every(row => row.category === 'zone-label-profile'));
        checkpoint.publicSleepReplay = result.rows.filter(row => ['public-sleep-lifecycle', 'public-sleep-isolation'].includes(row.category));
        assert.equal(checkpoint.publicSleepReplay.length, 8); assert.ok(checkpoint.publicSleepReplay.every(row => row.result === 'pass'));
      }
    }
    if (label.startsWith('packed-compiled-')) {
      const result = await json(join(directory, 'hidden-rows.json'));
      capture.total = result.rows.length; capture.pass = result.rows.filter(row => row.result === 'pass').length; capture.fail = result.rows.filter(row => row.result === 'fail').length; capture.summary = result.summary;
      assert.equal(capture.total, 304); assert.equal(capture.pass, label.endsWith('before') ? 265 : 291);
      assert.equal(manifest.commands['consumer-types'].status, 0); assert.equal(manifest.commands['consumer-build'].status, 0); assert.equal(manifest.commands.build.status, 0);
      assert.deepEqual(manifest.manifest.dependencies ?? {}, {}); assert.equal(manifest.commands['negative-types'].status, 2);
      capture.tarballSha256 = manifest.tarballSha256; capture.root = result.root; capture.leaf = result.leaf;
      if (label.endsWith('after')) {
        checkpoint.newProfileFailures = result.rows.filter(row => row.result === 'fail' && row.category !== 'declared-N-format-gap-not-parity');
        assert.equal(checkpoint.newProfileFailures.length, 2);
        checkpoint.explicitUnsupportedComparisons = result.rows.filter(row => row.category === 'declared-N-format-gap-not-parity');
        assert.equal(checkpoint.explicitUnsupportedComparisons.length, 11);
        checkpoint.sourceHashes = Object.fromEntries(Object.entries(manifest.inputs).filter(([path]) => path.startsWith('src/commands/time-env/')));
        checkpoint.versions = manifest.versions;
      }
    }
    checkpoint.captures.push(capture); await archive(label, directory);
  }
  checkpoint.primary = { profile: 'GNU coreutils 9.7 built on Darwin, C locale; Apple separate', manual: 'https://raw.githubusercontent.com/coreutils/coreutils/v9.7/doc/coreutils.texi', archiveSha256: original.primary?.archiveSha256 ?? 'e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf' };
  const primaryArchive = join(repo, 'tests/commands/metadata-stress/.oracle/coreutils-9.7.tar.xz');
  assert.equal(hash(await readFile(primaryArchive)), checkpoint.primary.archiveSha256);
  const primarySource = execFileSync('/usr/bin/tar', ['-xOf', primaryArchive, 'coreutils-9.7/lib/strftime.c'], { maxBuffer: 1024 * 1024 });
  assert.equal(hash(primarySource), hash(await readFile(join(repo, 'tests/commands/metadata-stress/.oracle/coreutils-9.7/lib/strftime.c'))));
  checkpoint.primary.strftimeSha256 = hash(primarySource);
  checkpoint.primary.isoYearCaseLines = 'lib/strftime.c:1960-2011, negative ISO year two-digit absolute remainder';
  for (const name of ['holdout.mts', 'guard.mjs', 'packed.mjs', 'seal.mjs']) checkpoint.reviewerInputs[name] = hash(await readFile(join(own, name)));
  await add('CHECKPOINT.json', Buffer.from(JSON.stringify(checkpoint, null, 2) + '\n'));
  await add('ARTIFACTS.json', Buffer.from(JSON.stringify(artifacts, null, 2) + '\n'));
  console.log(JSON.stringify(checkpoint.captures.map(({ label, total, pass, fail }) => ({ label, total, pass, fail }))));
}
