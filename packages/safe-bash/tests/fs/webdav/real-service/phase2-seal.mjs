import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

const own = dirname(import.meta.filename);
const repo = resolve(own, '../../../..');
const source = '93c009df1d3de38207d0000b451839f29fa898f6';
const previous = 'a4c7824ef62e5e053218c234c373d93999ff46c9';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = {};
async function visit(folder, prefix = '') {
  for (const entry of (await readdir(folder, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    assert.ok(!entry.name.startsWith('.work-'), `owned workspace remains: ${entry.name}`);
    const name = `${prefix}${entry.name}`;
    if (['PHASE2-CHECKPOINT.json', 'PHASE2-SHA256SUMS'].includes(name)) continue;
    if (entry.isDirectory()) await visit(join(folder, entry.name), `${name}/`);
    else hashes[name] = sha(await readFile(join(folder, entry.name)));
  }
}
await visit(own);
if (process.argv.includes('--check')) {
  const checkpoint = JSON.parse(await readFile(join(own, 'PHASE2-CHECKPOINT.json')));
  assert.deepEqual(hashes, checkpoint.hashes);
  assert.equal(sha(await readFile(join(own, 'PHASE2-SHA256SUMS'))), checkpoint.sumsSha256);
  console.log(`verified ${Object.keys(hashes).length} phase-two sealed files`);
} else {
  const priorResult = spawnSync('git', ['show', `${previous}:tests/fs/webdav/real-service/CHECKPOINT.json`], { cwd: repo, encoding: 'utf8', timeout: 10000 });
  assert.equal(priorResult.status, 0);
  const prior = JSON.parse(priorResult.stdout);
  let immutableFiles = 0;
  for (const [name, digest] of Object.entries(prior.hashes)) if (name.startsWith('evidence/')) {
    assert.equal(hashes[name], digest, `historical cohort changed: ${name}`); immutableFiles++;
  }
  assert.equal(hashes['CHECKPOINT.json'], sha(Buffer.from(priorResult.stdout)), 'historical seal changed');
  const cohorts = {};
  for (const name of await readdir(join(own, 'evidence'))) {
    const folder = join(own, 'evidence', name);
    let cleanup;
    try { cleanup = JSON.parse(await readFile(join(folder, 'cleanup.json'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (cleanup) {
      assert.ok(cleanup.workspace.startsWith(`${own}/.work-`));
      await assert.rejects(access(cleanup.workspace), { code: 'ENOENT' });
    }
    if (!['legacy-apache-final', 'legacy-wsgidav-final'].includes(name)) continue;
    const read = async file => JSON.parse(await readFile(join(folder, file)));
    const baseline = await read('baseline.json');
    const packageInfo = await read('package.json');
    const raw = await read('raw.json');
    const phase2 = await read('phase2-consumer.json');
    const fixture = await read('fixture-hashes.json');
    assert.equal(baseline.baseline, source);
    for (const [name, digest] of Object.entries(fixture)) assert.equal(sha(await readFile(join(folder, 'inputs', name))), digest);
    assert.ok(raw.rows.every(row => row.witnessEvents[1] > row.witnessEvents[0] && row.witnessErrors.length === 0));
    assert.ok(phase2.rows.every(row => row.lockWitnesses.length === 2 && row.lockWitnesses.every(witness => typeof witness.body === 'string' && !witness.error)));
    for (const [key, suffix] of [['root', '/dist/index.js'], ['webdav', '/dist/fs/webdav/index.js']]) {
      assert.equal(phase2.publicImports[key], `file://${cleanup.workspace}/consumer/node_modules/virtual-bash${suffix}`);
    }
    const artifacts = name.includes('apache') ? await read('apache-profile.json') : await read('dependencies.json');
    cohorts[name] = { source, archiveSha256: baseline.archiveSha256, sourceHashes: baseline.sourceHashes, packageSha256: packageInfo.sha256,
      packageExports: baseline.package.exports, runtimeDependencies: baseline.package.dependencies ?? {}, publicImports: phase2.publicImports,
      artifacts, summary: await read('summary.json'), cleanup, nativeWireWitnessesComplete: true, publicPostFailureLockWitnessesComplete: true };
  }
  assert.equal(Object.keys(cohorts).length, 2);
  assert.equal(cohorts['legacy-apache-final'].packageSha256, cohorts['legacy-wsgidav-final'].packageSha256);
  const sums = Object.entries(hashes).map(([name, digest]) => `${digest}  ${name}`).join('\n') + '\n';
  await writeFile(join(own, 'PHASE2-SHA256SUMS'), sums, { flag: 'wx' });
  await writeFile(join(own, 'PHASE2-CHECKPOINT.json'), JSON.stringify({ sealedAt: new Date().toISOString(), authorOnly: true, source,
    legacyLockCommit: '0e69b39a61cd94d8bb5897be4bc863dd6b0201dd', previousCheckpoint: previous, immutableHistoricalCohortFiles: immutableFiles,
    hashes, sumsSha256: sha(Buffer.from(sums)), cohorts }, null, 2), { flag: 'wx' });
  console.log(`sealed ${Object.keys(hashes).length} files; ${immutableFiles} historical cohort files unchanged; all owned workspaces absent`);
}
