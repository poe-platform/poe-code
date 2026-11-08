import assert from 'node:assert/strict';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { runProductRow } from './product-row-bytes-v2.mjs';
import { runHost } from './hosts.mjs';

const [requestPath] = process.argv.slice(2);
assert.ok(requestPath, 'Use an isolated, source-guarded parent request');
const request = JSON.parse(await readFile(requestPath));
assert.ok(process.env.PROFILE_REVIEW_POLICY && process.env.PROFILE_REVIEW_TRACE, 'Actual module-load guard is mandatory, including child tracing');
const archive = await realpath(resolve(request.archive));
assert.notEqual(archive, '/Users/kjopek/Workspace/safe-bash', 'No live product overlay');
assert.equal(await realpath(resolve(archive, 'src')), resolve(archive, 'src'), 'No aliased source root');
const digest = value => createHash('sha256').update(value).digest('hex');
async function sourceHashes(directory = resolve(archive, 'src'), prefix = 'src/') {
  const hashes = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name), key = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(hashes, await sourceHashes(path, `${key}/`));
    else { assert.ok(entry.isFile(), 'Source symlinks rejected'); hashes[key] = digest(await readFile(path)); }
  }
  return hashes;
}
const before = await sourceHashes();
assert.deepEqual(before, request.sourceHashes);
const load = () => import(pathToFileURL(resolve(archive, 'src/index.ts')).href);
let result;
if (request.kind === 'host') result = await runHost(load, request.id);
else {
  assert.equal(request.kind, 'row');
  const capture = JSON.parse(await readFile(new URL('./native-aligned.json', import.meta.url)));
  const row = capture.profiles[0].rows.find(candidate => candidate.id === request.id && candidate.category === request.category);
  assert.ok(row);
  result = await runProductRow(load, row);
}
const after = await sourceHashes();
assert.deepEqual(after, before);
console.log(JSON.stringify({ sourceCommit: request.sourceCommit, archive, before, after, result }));
