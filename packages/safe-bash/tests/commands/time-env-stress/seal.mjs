import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { openSync, closeSync } from 'node:fs';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const own = dirname(import.meta.filename), repo = resolve(own, '../../..');
const target = join(own, 'evidence');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path));
const artifacts = [];
async function add(path, bytes) {
  const output = join(target, path), text = bytes.toString('utf8');
  assert.deepEqual(Buffer.from(text), bytes);
  await assert.rejects(access(output), error => error.code === 'ENOENT');
  const temporary = await mkdtemp('/tmp/safe-bash-time-env-patch-');
  let descriptor;
  try {
    await writeFile(join(temporary, 'patch'), `*** Begin Patch\n*** Add File: ${output}\n${text.replace(/\n$/, '').split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`);
    descriptor = openSync(join(temporary, 'patch'), 'r');
    const result = spawnSync('apply_patch', [], { cwd: repo, stdio: [descriptor, 'pipe', 'pipe'], encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
  } finally { if (descriptor !== undefined) closeSync(descriptor); await rm(temporary, { recursive: true, force: true }); }
  return hash(await readFile(output));
}
async function archive(directory, prefix) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await archive(join(directory, entry.name), path);
    else {
      assert.ok(entry.isFile());
      const bytes = await readFile(join(directory, entry.name));
      let encoded = bytes;
      if (entry.name.endsWith('.json')) { encoded = Buffer.from(JSON.stringify(JSON.parse(bytes)) + '\n'); assert.deepEqual(JSON.parse(encoded), JSON.parse(bytes)); }
      const archivedSha256 = await add(path, encoded);
      artifacts.push({ path, capturedSha256: hash(bytes), archivedSha256, capturedBytes: bytes.length,
        transformation: entry.name.endsWith('.json') ? 'lossless JSON compaction' : 'text with terminal newline normalization' });
    }
  }
}
if (process.argv.includes('--check')) {
  for (const entry of await json(join(target, 'ARTIFACTS.json'))) assert.equal(hash(await readFile(join(target, entry.path))), entry.archivedSha256, entry.path);
  const checkpoint = await json(join(target, 'CHECKPOINT.json'));
  for (const [path, expected] of Object.entries(checkpoint.reviewerInputs)) assert.equal(hash(await readFile(join(own, path))), expected, path);
  console.log('sealed inputs and artifacts verified');
} else {
  const directories = process.argv.slice(2); assert.equal(directories.length, 3);
  for (const directory of directories) assert.ok(directory.startsWith('/tmp/'));
  const source = 'd904ca986fa945df8aef6e11b4165e2c2a63f814';
  const checkpoint = { source, createdAt: new Date().toISOString(), sourceAcceptance: { date: false, sleep: false, printenv: 'scoped GNU-profile/own-key checks only' },
    publicDefaultIntegration: false, wholeProductAcceptance: false, captures: [], reviewerInputs: {} };
  const author = JSON.parse(execFileSync('git', ['show', '1966945:tests/commands/time-env/evidence/frozen-d904ca9/manifest-before.json'], { cwd: repo, maxBuffer: 8 * 1024 * 1024 }));
  for (const [index, directory] of directories.entries()) {
    const manifest = await json(join(directory, 'manifest-after.json'));
    assert.equal(manifest.source, source); assert.equal(manifest.archiveSha256, author.archiveSha256);
    assert.deepEqual(manifest.inputs, author.sourceHashes); assert.equal(manifest.inputsUnchanged, true); assert.equal(manifest.cleaned, true);
    await assert.rejects(access(manifest.scratch), error => error.code === 'ENOENT');
    for (const command of Object.values(manifest.commands)) { assert.deepEqual(command.survivors, []); assert.equal(command.timedOut, false); assert.equal(command.outputExceeded, false); }
    assert.deepEqual(manifest.commands['unchanged-author'].counts, { tests: 223, pass: 223, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
    const result = await json(join(directory, 'holdouts.json'));
    const label = ['attempt1', 'attempt2', 'final'][index];
    checkpoint.captures.push({ label, startedAt: manifest.startedAt, finishedAt: manifest.finishedAt, total: result.rows.length,
      pass: result.rows.filter(row => row.result === 'pass').length, fail: result.rows.filter(row => row.result === 'fail').length,
      statuses: Object.fromEntries(Object.entries(manifest.commands).map(([name, value]) => [name, value.status])), summary: result.summary });
    if (label === 'final') {
      assert.equal(manifest.commands['consumer-types'].status, 0); assert.equal(manifest.commands['author-types'].status, 0);
      assert.equal(manifest.commands.build.status, 0); assert.equal(manifest.commands.independent.status, 1); assert.equal(manifest.commands['negative-types'].status, 2);
      assert.equal(await readFile(join(directory, 'independent.stderr'), 'utf8'), '');
      checkpoint.productFailures = result.rows.filter(row => row.result === 'fail' && row.category !== 'Apple-BSD-observed-not-target');
      assert.deepEqual(checkpoint.productFailures.map(row => row.name), ['flag %12F', 'flag %#c', 'flag %-z', 'flag %_z', 'flag %_12z', 'flag %^P', 'sleep exact total 0.0009999999 0.0000000001', 'sleep exact total 0.0004999999 0.0005000001']);
      checkpoint.profileDisagreements = result.rows.filter(row => row.category === 'Apple-BSD-observed-not-target');
      checkpoint.actualFrozenRegistry = result.rows[0].names; assert.equal(checkpoint.actualFrozenRegistry.length, 65);
      checkpoint.sourceHashes = Object.fromEntries(Object.entries(manifest.inputs).filter(([path]) => path.startsWith('src/commands/time-env/')));
      checkpoint.archiveSha256 = manifest.archiveSha256; checkpoint.versions = manifest.versions; checkpoint.native = manifest.native;
      checkpoint.publicSleep = result.rows.filter(row => ['public-sleep-lifecycle', 'public-sleep-isolation'].includes(row.category));
      assert.equal(checkpoint.publicSleep.length, 8); assert.ok(checkpoint.publicSleep.every(row => row.result === 'pass'));
    }
    await archive(directory, label);
  }
  for (const name of ['run.mjs', 'guard.mjs', 'consumer.mts', 'seal.mjs', 'EARLY_FINDINGS.md']) checkpoint.reviewerInputs[name] = hash(await readFile(join(own, name)));
  artifacts.push({ path: 'CHECKPOINT.json', archivedSha256: await add('CHECKPOINT.json', Buffer.from(JSON.stringify(checkpoint, null, 2) + '\n')) });
  await add('ARTIFACTS.json', Buffer.from(JSON.stringify(artifacts, null, 2) + '\n'));
  console.log(JSON.stringify(checkpoint.captures.map(({ label, total, pass, fail, statuses }) => ({ label, total, pass, fail, statuses })), null, 2));
}
