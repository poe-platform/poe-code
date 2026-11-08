import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const own = dirname(fileURLToPath(import.meta.url)), locator = JSON.parse(readFileSync('/tmp/owned-output-first-read-current.json'));
const binding = JSON.parse(readFileSync(locator.binding)), hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(readFileSync(binding.node)), binding.nodeSHA256);
cpSync(join(own, 'observer.mjs'), join(binding.consumer, 'observer.mjs'));
function inventory(root) { const result = {}; for (const name of readdirSync(root).sort()) {
  const path = join(root, name), stat = lstatSync(path); assert(!stat.isSymbolicLink(), path);
  if (stat.isDirectory()) { result[name + '/'] = 'directory'; for (const [child, digest] of Object.entries(inventory(path))) result[name + '/' + child] = digest; }
  else { assert(stat.isFile()); result[name] = hash(readFileSync(path)); }
} return result; }
const before = inventory(binding.consumer), output = mkdtempSync(join(binding.work, 'run-')), rows = [];
const cases = ['first-read-head-zero', 'first-read-local', 'first-read-s3', 'first-read-webdav', 'first-read-curl-body', 'first-read-curl-headers', 'new-local-cleanup-only', 'new-local-enrolled', 'new-legacy-controlled', 'new-required-destinations', 'new-webdav-body-acquired', 'new-curl-body-acquired'];
const selected = process.argv.slice(2), chosen = selected.length ? cases.filter(id => selected.includes(id)) : cases;
assert(chosen.length > 0);
for (let repeat = 1; repeat <= 2; repeat++) for (const id of chosen) {
  const directory = join(output, `${repeat}-${id}`); mkdirSync(directory);
  const resultPath = join(directory, 'observation.json');
  const child = spawnSync(binding.node, ['--unhandled-rejections=strict', '--experimental-loader', join(binding.consumer, 'loader.mjs'), join(binding.consumer, 'observer.mjs'), id], {
    cwd: binding.consumer, encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024,
    env: { PATH: dirname(binding.node) + ':/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC', NODE_OPTIONS: '', REVIEW_STATE: locator.binding, REVIEW_TRACE: join(directory, 'imports.jsonl'), OBSERVER_RESULT: resultPath },
  });
  writeFileSync(join(directory, 'stdout'), child.stdout ?? ''); writeFileSync(join(directory, 'stderr'), child.stderr ?? '');
  let observation; try { observation = JSON.parse(readFileSync(resultPath)); } catch {}
  const row = { id, repeat, status: child.status, signal: child.signal, error: child.error?.message, observation };
  rows.push(row); console.log(id, repeat, child.status, observation?.observation?.completedWithin1200ms, observation?.observerFailures, observation?.cleanupErrors);
}
assert.deepEqual(inventory(binding.consumer), before, 'Candidate package/generated fixture tree changed');
writeFileSync(join(output, 'REPORT.json'), JSON.stringify({ kind: 'VERSIONED_OBSERVATION_NOT_CANONICAL_RESCORE', candidate: binding.candidate, tree: binding.tree, packageSHA256: binding.packageSHA256, node: binding.node, nodeSHA256: binding.nodeSHA256, observerSHA256: hash(readFileSync(join(own, 'observer.mjs'))), bindingSHA256: hash(readFileSync(locator.binding)), inputsUnchanged: true, before, rows }, null, 2));
console.log('REPORT', output);
if (rows.some(row => row.status !== 0 || !row.observation?.naturalCompletion)) process.exitCode = 1;
