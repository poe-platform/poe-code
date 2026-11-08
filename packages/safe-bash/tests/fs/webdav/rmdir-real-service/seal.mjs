import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const own = dirname(import.meta.filename), repo = resolve(own, '../../../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = {};
async function visit(folder, prefix = '') {
  for (const entry of (await readdir(folder, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    assert.ok(!entry.name.startsWith('.work-'), `owned workspace remains: ${entry.name}`);
    const name = `${prefix}${entry.name}`;
    if (['CHECKPOINT.json', 'SHA256SUMS'].includes(name)) continue;
    if (entry.isDirectory()) await visit(join(folder, entry.name), `${name}/`);
    else hashes[name] = sha(await readFile(join(folder, entry.name)));
  }
}
await visit(own);
if (process.argv.includes('--check')) {
  const checkpoint = JSON.parse(await readFile(join(own, 'CHECKPOINT.json')));
  assert.deepEqual(hashes, checkpoint.hashes);
  assert.equal(sha(await readFile(join(own, 'SHA256SUMS'))), checkpoint.sumsSha256);
  console.log(`verified ${Object.keys(hashes).length} rmdir feasibility files`);
} else {
  const source = 'debb29ead94ae387f359d9d04b333ee4380f88d6';
  const git = args => { const result = spawnSync('git', args, { cwd: repo, timeout: 10000, maxBuffer: 16 * 1024 * 1024 }); assert.equal(result.status, 0); return result.stdout; };
  const unchangedSource = {};
  for (const name of ['src/fs/webdav/webdav.ts', 'src/fs/webdav/xml.ts', 'src/contracts/filesystem.md']) {
    const expected = sha(git(['show', `${source}:${name}`])); assert.equal(sha(await readFile(join(repo, name))), expected); unchangedSource[name] = expected;
  }
  const old = JSON.parse(await readFile(join(own, '../real-service/SCOPE-CHECKPOINT.json')));
  for (const [name, digest] of Object.entries(old.hashes)) assert.equal(sha(await readFile(join(own, '../real-service', name))), digest, `historical author file changed: ${name}`);
  const cohorts = {};
  for (const name of ['feasibility-first', 'feasibility-final']) {
    const folder = join(own, 'evidence', name);
    const read = async file => JSON.parse(await readFile(join(folder, file)));
    const run = await read('run.json');
    assert.equal(run.source, source); assert.equal(run.commands.find(command => command.name === 'validation').status, 0);
    assert.ok(run.cleanup.workspace.startsWith(`${own}/.work-`)); await assert.rejects(access(run.cleanup.workspace), { code: 'ENOENT' });
    const validation = await read('validation/cleanup.json'); await assert.rejects(access(validation.workspace), { code: 'ENOENT' });
    cohorts[name] = { source, validationPassed: true, inputs: run.inputs, cleanup: run.cleanup, providers: {} };
    for (const provider of ['apache', 'wsgidav']) {
      const baseline = await read(`${provider}/baseline.json`), pack = await read(`${provider}/package.json`), probe = await read(`${provider}/feasibility.json`);
      assert.equal(probe.rows.length, 12);
      const cleanup = await read(`${provider}/cleanup.json`); await assert.rejects(access(cleanup.workspace), { code: 'ENOENT' });
      assert.ok(cleanup.serverExitCode !== null || cleanup.serverSignalCode !== null);
      const summary = {};
      for (const surface of ['public', 'raw']) summary[surface] = Object.fromEntries(['positive', 'guard', 'refusal'].map(kind => [kind,
        Object.fromEntries(['pass', 'fail', 'refused'].map(result => [result, probe.rows.filter(row => row.surface === surface && row.kind === kind && row.result === result).length]))]));
      if (provider === 'apache') {
        const native = probe.rows.find(row => row.name.startsWith('native child'));
        assert.equal(native.result, 'fail');
        assert.ok(native.observations.some(entry => entry.candidateDeleteStatus === 204));
        assert.ok(Object.values(native.witnesses).every(entry => entry.error === 'ENOENT'));
        assert.ok(native.observations.some(entry => entry.beforeDelete && Object.values(entry.beforeDelete).some(value => value.bytes?.join(',') === '0,255,128,65,13,10')));
      }
      cohorts[name].providers[provider] = { summary, originalSummary: await read(`${provider}/summary.json`), packageSha256: pack.sha256,
        sourceArchiveSha256: baseline.archiveSha256, sourceHashes: baseline.sourceHashes, packageExports: baseline.package.exports, imports: probe.imports, cleanup,
        providerArtifacts: await read(`${provider}/${provider === 'apache' ? 'apache-profile.json' : 'dependencies.json'}`) };
    }
  }
  for (const provider of ['apache', 'wsgidav']) assert.deepEqual(cohorts['feasibility-first'].providers[provider].originalSummary, cohorts['feasibility-final'].providers[provider].originalSummary);
  const sums = Object.entries(hashes).map(([name, digest]) => `${digest}  ${name}`).join('\n') + '\n';
  await writeFile(join(own, 'SHA256SUMS'), sums, { flag: 'wx' });
  await writeFile(join(own, 'CHECKPOINT.json'), JSON.stringify({ sealedAt: new Date().toISOString(), authorOnly: true, productionChanged: false,
    unchangedSource, unchangedHistoricalAuthorFiles: Object.keys(old.hashes).length, hashes, sumsSha256: sha(Buffer.from(sums)), cohorts }, null, 2), { flag: 'wx' });
  console.log(`sealed ${Object.keys(hashes).length} files; source unchanged; ${Object.keys(old.hashes).length} historical author files unchanged`);
}
