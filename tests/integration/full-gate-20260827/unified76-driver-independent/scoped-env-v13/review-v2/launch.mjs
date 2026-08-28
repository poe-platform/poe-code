import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {collectChild, successful} from './controls.mjs';

const here = dirname(fileURLToPath(import.meta.url));
assert.deepEqual(process.argv.slice(2), ['--cohort-once']);
const recipe = JSON.parse(readFileSync(join(here, 'RECIPE.json')));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(existsSync(join(here, 'LAUNCH-START.json')), false, 'one cohort only');
for (const row of recipe.code) assert.equal(digest(readFileSync(join(here, row.name))), row.sha256);
assert.equal(digest(readFileSync(recipe.node)), recipe.nodeSha256);
writeFileSync(join(here, 'LAUNCH-START.json'), JSON.stringify({at: new Date().toISOString(), pid: process.pid,
  command: [recipe.node, ...process.argv.slice(1)], recipeSha256: digest(readFileSync(join(here, 'RECIPE.json')))}, null, 2) + '\n', {flag: 'wx'});
const receipt = await collectChild(recipe.node, [join(here, 'review.mjs'), '--cohort-once'], {
  cwd: here, env: recipe.environment, timeoutMs: recipe.bounds.launchMs, maxOutputBytes: recipe.bounds.workerOutputBytes});
const raw = [];
for (const channel of ['stdout', 'stderr']) {
  const bytes = receipt[channel], compressed = gzipSync(bytes), name = 'coordinator-' + channel + '.gz';
  writeFileSync(join(here, name), compressed, {flag: 'wx'});
  raw.push({path: name, bytes: bytes.length, sha256: digest(bytes), compressedBytes: compressed.length, compressedSha256: digest(compressed)});
}
const {stdout, stderr, ...status} = receipt;
const result = {at: new Date().toISOString(), status, raw, accepted: successful(receipt),
  claim: 'Per-stream lexical collector and actual close status; no reporter-string override or arbitrary background-tree guarantee'};
writeFileSync(join(here, 'OUTER-CAPTURE.json'), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
process.stdout.write(stdout); process.stderr.write(stderr);
console.log(JSON.stringify({outerAccepted: result.accepted, actualCoordinatorStatus: receipt.status, signal: receipt.signal}));
process.exitCode = result.accepted ? 0 : 1;
