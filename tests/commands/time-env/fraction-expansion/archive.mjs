import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const own = dirname(import.meta.filename), repo = resolve(own, '../../../..'), target = join(own, 'evidence');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path));
const files = [];
async function add(path, bytes) {
  const text = bytes.toString().replace(/\n?$/, '\n'), scratch = await mkdtemp('/tmp/fraction-evidence-');
  try {
    const patch = join(scratch, 'input.patch');
    await writeFile(patch, `*** Begin Patch\n*** Add File: ${join(target, path)}\n${text.split('\n').slice(0, -1).map(line => '+' + line).join('\n')}\n*** End Patch\n`);
    const handle = await open(patch, 'r');
    try { const result = spawnSync('apply_patch', [], { stdio: [handle.fd, 'pipe', 'pipe'] }); assert.equal(result.status, 0, result.stderr?.toString()); }
    finally { await handle.close(); }
  } finally { await rm(scratch, { recursive: true, force: true }); }
  files.push({ path, sha256: hash(await readFile(join(target, path))) });
}
if (process.argv.includes('--check')) {
  for (const entry of await json(join(target, 'ARTIFACTS.json'))) assert.equal(hash(await readFile(join(target, entry.path))), entry.sha256, entry.path);
  const checkpoint = await json(join(target, 'CHECKPOINT.json'));
  for (const [path, expected] of Object.entries(checkpoint.inputs)) assert.equal(hash(await readFile(join(own, path))), expected, path);
  console.log('fraction expansion author evidence verified');
} else {
  const source = execFileSync('git', ['rev-parse', 'c782363^{commit}'], { cwd: repo }).toString().trim();
  const checkpoint = { source, capturedAt: new Date().toISOString(), independentAcceptance: false, rootExportsChanged: false, defaultIntegration: false, captures: [], inputs: {} };
  const directories = [
    ['regression-replay', '/tmp/safe-bash-time-env-fraction-expanded-replay-20260827', 'manifest-after.json'],
    ['packed-replay', '/tmp/safe-bash-time-env-fraction-expanded-packed-20260827', 'manifest.json'],
    ['feature-controls', '/tmp/safe-bash-time-env-fraction-frozen-controls-20260827', 'manifest.json'],
  ];
  for (const [label, directory, manifestName] of directories) {
    const manifest = await json(join(directory, manifestName));
    assert.equal(manifest.cleaned, true); await assert.rejects(access(manifest.scratch), error => error.code === 'ENOENT');
    for (const command of Object.values(manifest.commands)) { assert.deepEqual(command.survivors, []); assert.equal(command.timedOut, false); assert.equal(command.outputExceeded, false); }
    const record = { label, source: manifest.source, candidate: manifest.candidate, commands: Object.fromEntries(Object.entries(manifest.commands).map(([name, result]) => [name, { status: result.status, counts: result.counts }])) };
    if (label === 'regression-replay') {
      assert.equal(manifest.inputsUnchanged, true);
      const result = await json(join(directory, 'holdouts.json')); record.total = result.rows.length; record.pass = result.rows.filter(row => row.result === 'pass').length;
      assert.equal(record.total, 305); assert.equal(record.pass, 304); assert.deepEqual(result.rows.filter(row => row.result === 'fail').map(row => row.name), ['Apple BSD printenv separate profile']);
      assert.equal(manifest.commands['unchanged-author'].counts.pass, 221); assert.equal(manifest.commands['unchanged-author'].counts.fail, 2);
      assert.equal(manifest.commands['new-author-regressions'].counts.pass, 83);
      checkpoint.publicSleep = result.rows.filter(row => ['public-sleep-lifecycle', 'public-sleep-isolation'].includes(row.category)); assert.equal(checkpoint.publicSleep.length, 8); assert.ok(checkpoint.publicSleep.every(row => row.result === 'pass'));
      const matrix = await json(join(directory, 'fresh-native-matrix.json'));
      checkpoint.ICUProfileDifferences = matrix.rows.filter(row => !row.gnuMatch); assert.equal(checkpoint.ICUProfileDifferences.length, 5);
      const log = await readFile(join(directory, 'unchanged-author.stdout'), 'utf8');
      checkpoint.legacyRejectionFailures = [...log.matchAll(/^not ok \d+ - (.*)$/gm)].map(match => match[1]);
      assert.equal(checkpoint.legacyRejectionFailures.length, 2); assert.ok(checkpoint.legacyRejectionFailures.every(name => name.endsWith('+%12N') || name.endsWith('+%-N')));
    } else if (label === 'packed-replay') {
      assert.equal(manifest.source, source); assert.equal(manifest.inputsUnchanged, true);
      const result = await json(join(directory, 'hidden-rows.json')); record.total = result.rows.length; record.pass = result.rows.filter(row => row.result === 'pass').length;
      assert.equal(record.total, 304); assert.equal(record.pass, 304);
      assert.deepEqual(manifest.manifest.dependencies ?? {}, {}); assert.equal(manifest.commands['consumer-types'].status, 0); assert.equal(manifest.commands['consumer-build'].status, 0);
      checkpoint.tarballSha256 = manifest.tarballSha256; checkpoint.sourceHashes = Object.fromEntries(Object.entries(manifest.inputs).filter(([path]) => path.startsWith('src/commands/time-env/')));
      checkpoint.actualRegistry = result.rows.find(row => row.name === 'packed registration is optional; export map unchanged').names;
    } else {
      assert.equal(manifest.source, source); assert.equal(manifest.sourceRestored, true);
      assert.equal(manifest.commands.feature.counts.pass, 54); assert.equal(manifest.commands['restored-feature'].counts.pass, 54);
      for (const name of ['mutant-output-preflight', 'mutant-left-padding', 'mutant-ISO-wrap']) assert.equal(manifest.commands[name].status, 1);
    }
    checkpoint.captures.push(record);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.ok(entry.isFile(), entry.name); const bytes = await readFile(join(directory, entry.name));
      await add(`${label}/${entry.name}`, entry.name.endsWith('.json') ? Buffer.from(JSON.stringify(JSON.parse(bytes)) + '\n') : bytes);
      Object.assign(files.at(-1), { capturedSha256: hash(bytes), transform: entry.name.endsWith('.json') ? 'lossless JSON compaction' : 'terminal newline normalization' });
    }
  }
  for (const name of ['native-v1.json', 'native-after-v1.json', 'capture.mjs', 'verify.mjs', 'packed-replay.mjs', 'nanoseconds.test.ts', 'iso-year.test.ts', 'tsconfig.json', 'SEMANTICS.md', 'archive.mjs']) checkpoint.inputs[name] = hash(await readFile(join(own, name)));
  await add('CHECKPOINT.json', Buffer.from(JSON.stringify(checkpoint, null, 2) + '\n'));
  await add('ARTIFACTS.json', Buffer.from(JSON.stringify(files, null, 2) + '\n'));
  console.log(JSON.stringify(checkpoint.captures.map(({ label, total, pass }) => ({ label, total, pass }))));
}
