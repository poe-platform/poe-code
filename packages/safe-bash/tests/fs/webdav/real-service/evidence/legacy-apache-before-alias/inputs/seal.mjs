import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

const own = dirname(import.meta.filename);
const repo = resolve(own, '../../../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const hashes = {};
async function visit(path, prefix = '') {
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const name = `${prefix}${entry.name}`;
    if (entry.name.startsWith('.work-')) throw new Error(`unremoved owned workspace ${name}`);
    if (['SHA256SUMS', 'CHECKPOINT.json'].includes(name)) continue;
    if (entry.isDirectory()) await visit(join(path, entry.name), `${name}/`);
    else hashes[name] = sha(await readFile(join(path, entry.name)));
  }
}
await visit(own);
if (process.argv.includes('--check')) {
  const prior = JSON.parse(await readFile(join(own, 'CHECKPOINT.json'), 'utf8'));
  assert.deepEqual(hashes, prior.hashes);
  assert.equal(sha(await readFile(join(own, 'SHA256SUMS'))), prior.sha256sumsHash);
  console.log(`verified ${Object.keys(hashes).length} sealed files`);
} else {
  const cohorts = {};
  for (const name of await readdir(join(own, 'evidence'))) {
    const folder = join(own, 'evidence', name);
    const entry = {};
    for (const file of ['baseline.json', 'summary.json', 'cleanup.json', 'apache-profile.json', 'package.json']) {
      try { entry[file] = JSON.parse(await readFile(join(folder, file), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const cleanup = entry['cleanup.json'];
    if (cleanup) {
      assert.ok(cleanup.workspace.startsWith(`${own}/.work-`));
      await assert.rejects(access(cleanup.workspace), { code: 'ENOENT' });
      entry.workspaceAbsentAtSeal = true;
    }
    if (name.endsWith('-final')) {
      const raw = JSON.parse(await readFile(join(folder, 'raw.json'), 'utf8'));
      assert.ok(raw.rows.every(row => row.witnessEvents[1] > row.witnessEvents[0] && row.witnessErrors.length === 0));
      const fixture = JSON.parse(await readFile(join(folder, 'fixture-hashes.json'), 'utf8'));
      for (const [path, expected] of Object.entries(fixture)) assert.equal(sha(await readFile(join(folder, 'inputs', path))), expected);
      entry.finalWireWitnessesComplete = true;
      entry.currentFixtureMatches = Object.entries(fixture).every(([path, expected]) => hashes[path] === expected);
      assert.ok(entry.currentFixtureMatches);
    }
    cohorts[name] = {
      baseline: entry['baseline.json']?.baseline,
      sourceArchiveHash: entry['baseline.json']?.archiveSha256,
      packedTarHash: entry['package.json']?.sha256,
      summary: entry['summary.json'], cleanup,
      apacheBinaryAndModules: entry['apache-profile.json']?.artifacts,
      apacheProfileHash: entry['apache-profile.json'] ? sha(Buffer.from(entry['apache-profile.json'].config)) : undefined,
      workspaceAbsentAtSeal: entry.workspaceAbsentAtSeal,
      finalWireWitnessesComplete: entry.finalWireWitnessesComplete,
      currentFixtureMatches: entry.currentFixtureMatches,
    };
  }
  const tools = {};
  for (const name of ['typescript', 'tsx', '@types/node']) {
    const bytes = await readFile(join(repo, 'node_modules', name, 'package.json'));
    tools[name] = { version: JSON.parse(bytes).version, packageJsonSha256: sha(bytes) };
  }
  const sums = Object.entries(hashes).map(([path, digest]) => `${digest}  ${path}`).join('\n') + '\n';
  await writeFile(join(own, 'SHA256SUMS'), sums);
  await writeFile(join(own, 'CHECKPOINT.json'), JSON.stringify({ sealedAt: new Date().toISOString(), node: process.versions, toolsRecordedAtSeal: tools, hashes, sha256sumsHash: sha(Buffer.from(sums)), cohorts }, null, 2));
  console.log(`sealed ${Object.keys(hashes).length} files; owned workspace absence verified`);
}
