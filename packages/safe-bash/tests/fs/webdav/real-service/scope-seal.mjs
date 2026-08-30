import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const own = dirname(import.meta.filename);
const repo = resolve(own, '../../../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = {};
async function inventory(folder, prefix = '') {
  for (const entry of (await readdir(folder, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    assert.ok(!entry.name.startsWith('.work-'), `owned workspace remains: ${entry.name}`);
    const name = `${prefix}${entry.name}`;
    if (['SCOPE-CHECKPOINT.json', 'SCOPE-SHA256SUMS'].includes(name)) continue;
    if (entry.isDirectory()) await inventory(join(folder, entry.name), `${name}/`);
    else hashes[name] = sha(await readFile(join(folder, entry.name)));
  }
}
await inventory(own);
if (process.argv.includes('--check')) {
  const prior = JSON.parse(await readFile(join(own, 'SCOPE-CHECKPOINT.json')));
  assert.deepEqual(hashes, prior.hashes);
  assert.equal(sha(await readFile(join(own, 'SCOPE-SHA256SUMS'))), prior.sumsSha256);
  console.log(`verified ${Object.keys(hashes).length} scope checkpoint files`);
} else {
  const prior = JSON.parse(await readFile(join(own, 'PHASE2-CHECKPOINT.json')));
  for (const [name, digest] of Object.entries(prior.hashes)) assert.equal(hashes[name], digest, `historical author file changed: ${name}`);
  const git = args => {
    const result = spawnSync('git', args, { cwd: repo, timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, String(result.stderr)); return result.stdout;
  };
  const independentFiles = git(['ls-tree', '-r', '--name-only', '6e0ff0b', '--', 'tests/fs/webdav/real-service-independent']).toString().trim().split('\n');
  for (const name of independentFiles) assert.equal(sha(await readFile(join(repo, name))), sha(git(['show', `6e0ff0b:${name}`])), `read-only independent input changed: ${name}`);
  const cohorts = {};
  for (const name of ['scope-before', 'scope-parent-before', 'scope-after']) {
    const folder = join(own, 'evidence', name);
    const read = async file => JSON.parse(await readFile(join(folder, file)));
    const outer = await read('cleanup.json');
    assert.ok(outer.workspace.startsWith('/tmp/safe-bash-webdav-scope-author-'));
    await assert.rejects(access(outer.workspace), { code: 'ENOENT' });
    const run = await read('capture/run.json');
    assert.equal(run.cleanup, true); assert.equal(run.validationPassed, true);
    await assert.rejects(access(run.temporary), { code: 'ENOENT' });
    const validation = await read('capture/unchanged-validation/cleanup.json');
    await assert.rejects(access(validation.workspace), { code: 'ENOENT' });
    cohorts[name] = { source: run.source, sourceSha256: run.sourceHash, fixtureHashes: run.inputs, validationPassed: true, cleanup: outer, providers: {} };
    for (const provider of ['apache', 'wsgidav']) {
      const baseline = await read(`capture/${provider}/baseline.json`);
      const pack = await read(`capture/${provider}/package.json`);
      const independent = await read(`capture/${provider}/independent.json`);
      const cleanup = await read(`capture/${provider}/cleanup.json`);
      assert.ok(cleanup.serverExitCode !== null || cleanup.serverSignalCode !== null);
      await assert.rejects(access(cleanup.workspace), { code: 'ENOENT' });
      assert.equal(independent.rows.length, 31);
      const pass = independent.rows.filter(row => row.result === 'pass').length;
      const fail = independent.rows.filter(row => row.result === 'fail').length;
      assert.equal(pass + fail, 31);
      assert.equal(pass, provider === 'wsgidav' ? 29 : name === 'scope-after' ? 31 : 28);
      const raw = await read(`capture/${provider}/raw.json`);
      assert.ok(raw.rows.every(row => row.witnessEvents[1] > row.witnessEvents[0] && row.witnessErrors.length === 0));
      cohorts[name].providers[provider] = { independent: { pass, fail, skip: 0 }, original: await read(`capture/${provider}/summary.json`),
        sourceArchiveSha256: baseline.archiveSha256, sourceHashes: baseline.sourceHashes, packageSha256: pack.sha256,
        publicImports: independent.imports, packageExports: baseline.package.exports, cleanup,
        providerArtifacts: await read(`capture/${provider}/${provider === 'apache' ? 'apache-profile.json' : 'dependencies.json'}`) };
      if (name === 'scope-after' && provider === 'apache') {
        const rows = independent.rows.filter(row => row.name.includes('contradictory'));
        assert.equal(rows.length, 3);
        for (const row of rows) {
          assert.equal(row.result, 'pass');
          assert.ok(!row.events.some(event => ['COPY', 'MOVE'].includes(event.method)));
          assert.ok(row.events.some(event => event.method === 'UNLOCK' && event.status === 204));
          for (const [path, witness] of Object.entries(row.witnesses)) assert.deepEqual(witness.bytes, path.endsWith('-source') ? [0, 255, 128, 195, 169, 13, 10, 0, 65] : [79, 76, 68]);
        }
        const results = independent.observations.filter(entry => entry.kind === 'grant-result' && entry.name.includes('contradictory'));
        assert.equal(results.length, 3); assert.ok(results.every(entry => entry.error.code === 'ENOTSUP'));
      }
    }
  }
  const before = cohorts['scope-parent-before'].providers;
  const after = cohorts['scope-after'].providers;
  for (const provider of ['apache', 'wsgidav']) {
    assert.deepEqual(Object.keys(before[provider].sourceHashes).filter(name => before[provider].sourceHashes[name] !== after[provider].sourceHashes[name]), ['src/fs/webdav/webdav.ts']);
    assert.deepEqual(before[provider].original, after[provider].original);
  }
  assert.equal(after.apache.packageSha256, after.wsgidav.packageSha256);
  const sums = Object.entries(hashes).map(([name, digest]) => `${digest}  ${name}`).join('\n') + '\n';
  await writeFile(join(own, 'SCOPE-SHA256SUMS'), sums, { flag: 'wx' });
  await writeFile(join(own, 'SCOPE-CHECKPOINT.json'), JSON.stringify({ sealedAt: new Date().toISOString(), authorOnly: true,
    source: '69672fe210fbf8a23cc980828bb46d073b078425', unchangedHistoricalAuthorFiles: Object.keys(prior.hashes).length,
    unchangedIndependentFiles: independentFiles.length, hashes, sumsSha256: sha(Buffer.from(sums)), cohorts }, null, 2), { flag: 'wx' });
  console.log(`sealed ${Object.keys(hashes).length} files; ${Object.keys(prior.hashes).length} historical author and ${independentFiles.length} independent files unchanged`);
}
