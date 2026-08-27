import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const own = dirname(import.meta.filename);
const repo = resolve(own, '../../../..');
const target = join(own, 'scope-fix-evidence');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const git = args => {
  const result = spawnSync('git', args, { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, String(result.stderr));
  return result.stdout;
};
const source = '69672fe210fbf8a23cc980828bb46d073b078425';
const parent = 'f73ff3aacd8889fbc2c1e835e2d237f572879ab7';
const summarize = rows => ({ total: rows.length, pass: rows.filter(row => row.result === 'pass').length,
  fail: rows.filter(row => row.result === 'fail').length, skipped: 0 });
const projection = rows => rows.map(({ name, kind, result }) => ({ name, kind, result }));
const entries = [];
async function add(relative, bytes) {
  const output = join(target, relative);
  const text = bytes.toString('utf8');
  assert.deepEqual(Buffer.from(text), bytes, 'only regular UTF-8 evidence');
  try {
    const existing = await readFile(output);
    assert.deepEqual(existing, Buffer.from(text.replace(/\n$/, '') + '\n'), `resume must preserve exact existing bytes: ${relative}`);
    return hash(existing);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const patch = `*** Begin Patch\n*** Add File: ${output}\n${text.replace(/\n$/, '').split('\n').map(line => `+${line}`).join('\n')}\n*** End Patch\n`;
  const temporary = await mkdtemp('/tmp/safe-bash-scope-patch-');
  let descriptor;
  try {
    await writeFile(join(temporary, 'patch'), patch);
    descriptor = openSync(join(temporary, 'patch'), 'r');
    const result = spawnSync('apply_patch', [], { cwd: repo, stdio: [descriptor, 'pipe', 'pipe'], encoding: 'utf8', timeout: 15000, maxBuffer: 32 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    await rm(temporary, { recursive: true, force: true });
  }
  return hash(await readFile(output));
}
async function archive(directory, prefix) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await archive(join(directory, entry.name), relative);
    else {
      assert.ok(entry.isFile(), 'no symlinked evidence');
      const bytes = await readFile(join(directory, entry.name));
      let encoded = bytes;
      if (entry.name.endsWith('.json')) {
        const value = JSON.parse(bytes);
        encoded = Buffer.from(JSON.stringify(value) + '\n');
        assert.deepEqual(JSON.parse(encoded), value);
      }
      const archivedSha256 = await add(relative, encoded);
      entries.push({ path: relative, capturedSha256: hash(bytes), archivedSha256, capturedBytes: bytes.length, archivedBytes: (await readFile(join(target, relative))).length,
        transformation: entry.name.endsWith('.json') ? 'lossless JSON compaction' : 'text; terminal newline normalized' });
    }
  }
}
if (process.argv.includes('--check')) {
  const manifest = await json(join(target, 'ARTIFACTS.json'));
  for (const entry of manifest) assert.equal(hash(await readFile(join(target, entry.path))), entry.archivedSha256, entry.path);
  const checkpoint = await json(join(target, 'CHECKPOINT.json'));
  for (const [name, expected] of Object.entries(checkpoint.reviewInputs)) assert.equal(hash(await readFile(join(own, name))), expected, name);
  console.log(`verified ${manifest.length} sealed artifacts and reviewer inputs`);
} else {
  const [final, before, attempt, primary] = process.argv.slice(2);
  for (const path of [final, before, attempt, primary]) assert.ok(path?.startsWith('/tmp/'));
  const checkpoint = { source, parent, createdAt: new Date().toISOString(), wholeProviderAcceptance: false,
    scopeAcceptance: true, sourceSha256: hash(git(['show', `${source}:src/fs/webdav/webdav.ts`])), reviewInputs: {}, providers: {} };
  assert.equal(checkpoint.sourceSha256, 'd61d6d36eeea65f0c7e6eb5ecbe118e353ffe5a87131e4e26c1a3d772ee71acf');
  assert.equal(git(['diff', '--name-only', parent, source, '--', 'src']).toString().trim(), 'src/fs/webdav/webdav.ts');
  for (const name of ['run.mjs', 'scope-neighbors.mts', 'public-guard.mjs', 'independent.mts', 'scope-seal.mjs', 'primary.mjs']) checkpoint.reviewInputs[name] = hash(await readFile(join(own, name)));
  assert.equal(checkpoint.reviewInputs['independent.mts'], hash(git(['show', '6e0ff0b:tests/fs/webdav/real-service-independent/independent.mts'])));
  for (const [label, directory, expected] of [['final', final, source], ['parent', before, parent], ['attempt1', attempt, source]]) {
    const run = await json(join(directory, 'run.json'));
    assert.equal(run.source, expected);
    assert.equal(run.cleanup, true);
    await assert.rejects(access(run.temporary), error => error.code === 'ENOENT');
    for (const provider of ['apache', 'wsgidav']) {
      const cleanup = await json(join(directory, provider, 'cleanup.json'));
      assert.equal(cleanup.removed, true);
      assert.ok(cleanup.serverExitCode !== null || cleanup.serverSignalCode !== null);
      await assert.rejects(access(cleanup.workspace), error => error.code === 'ENOENT');
    }
    await archive(directory, label);
  }
  const validation = await json(join(final, 'unchanged-validation/commands.json'));
  assert.ok(validation.every(command => command.status === 0));
  checkpoint.validation = validation.filter(command => command.args.includes('--test')).map(command => {
    const count = key => Number(command.stdout.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1]);
    const result = { args: command.args, tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped') };
    assert.equal(result.tests, result.pass); assert.equal(result.fail, 0); assert.equal(result.skipped, 0);
    return result;
  });
  checkpoint.strictTypesAndBuild = true;
  for (const provider of ['apache', 'wsgidav']) {
    const current = join(final, provider), previous = join(before, provider);
    const baseline = await json(join(current, 'baseline.json'));
    const packed = await json(join(current, 'package.json'));
    assert.equal(packed.sha256, 'dd1efd2f90061c52bc0c40aee73ba8156e91c6da69e4e22022d1a0e74492a1f0');
    assert.deepEqual(baseline.package.dependencies ?? {}, {});
    const commands = await json(join(current, 'commands.json'));
    assert.ok(commands.every(command => command.status === 0));
    const originalMatrix = await json(join(current, 'summary.json'));
    const historical = join(own, 'evidence/final', provider);
    assert.deepEqual(originalMatrix, await json(join(historical, 'summary.json')));
    for (const name of ['raw.json', 'consumer.json', 'phase2-consumer.json']) {
      assert.deepEqual(projection((await json(join(current, name))).rows), projection((await json(join(historical, name))).rows));
    }
    const independent = await json(join(current, 'independent.json'));
    const oldIndependent = await json(join(previous, 'independent.json'));
    assert.deepEqual(independent.rows.map(row => row.name), oldIndependent.rows.map(row => row.name));
    const neighbors = await json(join(current, 'scope-neighbors.json'));
    const oldNeighbors = await json(join(previous, 'scope-neighbors.json'));
    assert.deepEqual(neighbors.rows.map(row => row.name), oldNeighbors.rows.map(row => row.name));
    checkpoint.providers[provider] = { originalMatrix, originalRowsUnchanged: true, packedSha256: packed.sha256,
      sourceArchiveSha256: baseline.archiveSha256, before: summarize(oldIndependent.rows), after: summarize(independent.rows),
      neighborsBefore: summarize(oldNeighbors.rows), neighborsAfter: summarize(neighbors.rows),
      neighborsMasked: neighbors.rows.filter(row => row.parserCoverageMasked).length,
      remainingIndependentFailures: independent.rows.filter(row => row.result === 'fail').map(row => row.name),
      remainingNeighborFailures: neighbors.rows.filter(row => row.result === 'fail').map(row => row.name) };
    if (provider === 'apache') {
      const repaired = independent.rows.filter(row => row.name.includes('contradictory'));
      assert.equal(repaired.length, 3);
      checkpoint.regressions = repaired.map(row => {
        const old = oldIndependent.rows.find(candidate => candidate.name === row.name);
        assert.equal(old.result, 'fail'); assert.equal(row.result, 'pass');
        assert.equal(independent.observations.find(entry => entry.kind === 'grant-result' && row.name.endsWith(entry.name)).error.code, 'ENOTSUP');
        assert.ok(!row.events.some(event => ['COPY', 'MOVE'].includes(event.method)));
        assert.ok(row.events.some(event => event.method === 'UNLOCK' && event.status === 204));
        assert.ok(old.events.some(event => ['COPY', 'MOVE'].includes(event.method) && event.status === 204));
        for (const [path, witness] of Object.entries(row.witnesses)) assert.deepEqual(witness.bytes, path.endsWith('-source') ? [0,255,128,195,169,13,10,0,65] : [79,76,68]);
        return { name: row.name, code: 'ENOTSUP', noTransfer: true, nativeBytesAndNamesPreserved: true, adapterUnlock204: true };
      });
    }
  }
  const attempted = (await readFile(join(own, 'scope-neighbors.mts'), 'utf8')).replace('redirect: "manual", credentials: "omit" });', 'redirect: "manual" });');
  assert.equal(hash(Buffer.from(attempted)), (await json(join(attempt, 'run.json'))).inputs['scope-neighbors.mts'].originalSha256);
  await add('attempt1/scope-neighbors.mts.txt', Buffer.from(attempted));
  await add('primary.json', await readFile(primary));
  await add('SOURCE_DELTA.diff', git(['diff', parent, source, '--', 'src/fs/webdav/webdav.ts']));
  await add('CHECKPOINT.json', Buffer.from(JSON.stringify(checkpoint, null, 2) + '\n'));
  for (const path of ['attempt1/scope-neighbors.mts.txt', 'primary.json', 'SOURCE_DELTA.diff', 'CHECKPOINT.json']) entries.push({ path, archivedSha256: hash(await readFile(join(target, path))) });
  await add('ARTIFACTS.json', Buffer.from(JSON.stringify(entries, null, 2) + '\n'));
  console.log(JSON.stringify(checkpoint.providers, null, 2));
}
