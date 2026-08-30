import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
assert.equal(process.argv[2], '--capture', 'Explicit immutable evidence capture only');
const own = dirname(fileURLToPath(import.meta.url)), repo = join(own, '../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inputs = [
  { work: '/private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/owned-output-first-read-GCKKWF', run: 'run-F8CJQK', commit: '51fb6b40', rows: 20 },
  { work: '/private/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/owned-output-first-read-KIJ4Te', run: 'run-GmwbwT', commit: '8a674adf', rows: 4 },
];
const files = {}, summaries = [], modules = new Map();
function inventory(root) { return Object.fromEntries(readdirSync(root).sort().flatMap(name => {
  const path = join(root, name), stat = lstatSync(path); assert(!stat.isSymbolicLink(), path);
  if (stat.isDirectory()) return [[name + '/', 'directory'], ...Object.entries(inventory(path)).map(([child, digest]) => [name + '/' + child, digest])];
  assert(stat.isFile()); return [[name, hash(readFileSync(path))]];
})); }
for (const [index, input] of inputs.entries()) {
  const report = JSON.parse(readFileSync(join(input.work, input.run, 'REPORT.json'))), binding = JSON.parse(readFileSync(join(input.work, 'BINDING.json')));
  assert.equal(report.rows.length, input.rows); assert(report.rows.every(row => row.status === 0 && row.signal === null && row.observation.naturalCompletion));
  assert.deepEqual(inventory(binding.consumer), report.before);
  const originalObserver = execFileSync('/usr/bin/git', ['--no-replace-objects', '-C', repo, 'show', input.commit + ':' + relative(repo, join(own, 'observer.mjs'))]);
  assert.equal(hash(originalObserver), report.observerSHA256);
  for (const [path, expected] of Object.entries(binding.inputs)) assert.equal(hash(execFileSync('/usr/bin/git', ['--no-replace-objects', '-C', repo, 'show', binding.candidate + ':' + path])), expected);
  const add = (path, bytes) => { files[`v${index + 1}/${path}`] = bytes.toString('base64'); };
  add('BINDING.json', readFileSync(join(input.work, 'BINDING.json'))); add('observer.mjs', originalObserver);
  for (const name of ['helpers.mjs', 'mock.mjs', 'loader.mjs']) add(name, readFileSync(join(binding.consumer, name)));
  function collect(directory) { for (const name of readdirSync(join(input.work, directory)).sort()) {
    const path = join(directory, name), absolute = join(input.work, path), stat = lstatSync(absolute); assert(!stat.isSymbolicLink());
    if (stat.isDirectory()) collect(path); else { assert(stat.isFile()); const bytes = readFileSync(absolute); add(path, bytes);
      if (name === 'imports.jsonl') for (const line of bytes.toString().trim().split('\n')) {
        const entry = JSON.parse(line), prefix = binding.consumer + '/node_modules/virtual-bash/';
        if (entry.path.startsWith(prefix)) { const relative = entry.path.slice(prefix.length); assert.equal(binding.installed[relative], entry.sha256); modules.set(relative, entry.sha256); }
      }
    }
  } }
  collect(input.run);
  const processMatches = execFileSync('/bin/ps', ['-axo', 'pid,ppid,command'], { encoding: 'utf8' }).split('\n').filter(line => line.includes(input.work)); assert.deepEqual(processMatches, []);
  summaries.push({ ...input, candidate: binding.candidate, packageSHA256: binding.packageSHA256, node: binding.node, nodeSHA256: binding.nodeSHA256, inputsUnchanged: true, processMatches, observations: report.rows.map(row => {
    const observation = row.observation; return { scenario: row.id, repeat: row.repeat, childStatus: row.status, observation: observation.observation, publicSnapshot: observation.snapshots.find(item => item.label === 'at-public-settlement'), beforeCleanup: observation.snapshots.find(item => item.label === 'before-harness-cleanup'), remoteClosedBeforeCleanup: observation.remoteClosedBeforeCleanup, containment: observation.containment, observerFailures: observation.observerFailures, cleanupErrors: observation.cleanupErrors, unhandled: observation.unhandled };
  }) });
}
const summary = { date: new Date().toISOString(), purpose: 'FIRST_READ_FACTS_AND_UNAPPLIED_PROPOSAL', originalCanonicalScore: 'unchanged historical 2/6; not rerun/rescored here', observerExecutions: 24, uniqueRecipes: 12, versions: summaries, authenticatedLoadedPackageModules: Object.fromEntries(modules) };
const data = Buffer.from(JSON.stringify({ summary, files })), gzip = gzipSync(data, { level: 9 });
const manifest = { dataSHA256: hash(data), gzipSHA256: hash(gzip), files: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, hash(Buffer.from(value, 'base64'))])) };
for (const [name, text] of [['data/EVIDENCE.json.gz.base64', gzip.toString('base64') + '\n'], ['data/MANIFEST.json', JSON.stringify(manifest, null, 2) + '\n'], ['data/SUMMARY.json', JSON.stringify(summary, null, 2) + '\n']]) {
  const path = join(own, name); assert(!existsSync(path), 'No evidence replacement');
  execFileSync('apply_patch', [], { input: '*** Begin Patch\n*** Add File: ' + path + '\n' + text.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n*** End Patch\n' });
}
console.log(JSON.stringify({ files: Object.keys(files).length, executions: summary.observerExecutions, modules: modules.size, compressedBytes: gzip.length }));
