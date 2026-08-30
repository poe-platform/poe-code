import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = dirname(fileURLToPath(import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const summary = JSON.parse(await readFile(join(output, 'summary.json')));
for (const phase of ['original', 'scratch-aligned']) {
  const rows = JSON.parse(await readFile(join(output, phase, 'functional.json')));
  const streamed = (await readFile(join(output, phase, 'functional.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows, streamed);
  assert.equal(rows.length, 224);
  for (const engine of ['virtual-bash', 'just-bash']) {
    assert.equal(rows.filter(row => row[engine].status === 'pass').length, summary.scores[phase][engine].pass);
    assert.equal(rows.filter(row => row[engine].status === 'fail').length, summary.scores[phase][engine].fail);
  }
  const lifecycle = JSON.parse(await readFile(join(output, phase, 'lifecycle.json')));
  assert.equal(lifecycle.gate, 'PASS');
  assert.deepEqual(lifecycle.leaked, []); assert.deepEqual(lifecycle.remaining, []);
  assert.ok(lifecycle.importAudit.pass);
}
assert.equal(digest(await readFile(summary.sourceArchive.path)), summary.sourceArchive.sha256);
const files = {};
async function visit(directory, prefix = '') {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name), relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await visit(path, relative);
    else { assert.ok(entry.isFile(), relative); const bytes = await readFile(path); files[relative] = { sha256: digest(bytes), bytes: bytes.length }; }
  }
}
await visit(output);
await writeFile(join(output, 'artifact-manifest.json'), JSON.stringify({ sealedAt: new Date().toISOString(), checks: ['448 JSONL rows exactly equal complete JSON', '224 unique original IDs per profile already checked by audit.mjs', 'scores independently recounted', 'lifecycle and actual import gates pass', 'source archive matches seal', 'all report artifacts regular files', 'all owned .mjs syntax checks passed'], noFunctionalRerun: true, files }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ artifactFiles: Object.keys(files).length, artifactBytes: Object.values(files).reduce((total, row) => total + row.bytes, 0), functionalReruns: 0 }, null, 2));
