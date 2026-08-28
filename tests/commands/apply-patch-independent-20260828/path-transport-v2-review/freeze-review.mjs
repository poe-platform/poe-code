import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sha256, objectId } from './review-reference.mjs';

const own = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(own, '../../../..');
const author = path.join(own, '../path-transport-v2');
const repairCommit = 'd8cbb7d76459e14d20f57e19f7c01ce04fa08702', preparationCommit = '7d7e322b7e11fdc2ded4b5a4708da2e0aedad65b';
const json = filename => JSON.parse(fs.readFileSync(filename));
const entries = new Map(), children = [];
function describe(filename) {
  const stat = fs.lstatSync(filename); assert.ok(!stat.isSymbolicLink());
  const relative = path.isAbsolute(filename) && !filename.startsWith(repository + '/') ? filename : path.relative(repository, filename);
  if (stat.isDirectory()) return { path: relative, type: 'directory', mode: stat.mode & 0o777, names: fs.readdirSync(filename).sort() };
  assert.ok(stat.isFile()); const bytes = fs.readFileSync(filename);
  return { path: relative, type: 'file', mode: stat.mode & 0o777, bytes: bytes.length, sha256: sha256(bytes), blob: objectId('blob', bytes) };
}
function admit(filename, expected) {
  const entry = describe(filename);
  if (expected) for (const key of ['mode', 'bytes', 'sha256']) if (expected[key] !== undefined) assert.equal(entry[key], expected[key], `${entry.path}:${key}`);
  entries.set(entry.path, entry); return entry;
}
function git(args) {
  const run = spawnSync('/usr/bin/git', ['--no-replace-objects', ...args], { cwd: repository, timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0' } });
  assert.equal(run.error, undefined); assert.equal(run.status, 0); assert.equal(run.signal, null);
  children.push({ args, pid: run.pid, status: run.status, signal: run.signal, stdoutBytes: run.stdout.length, stdoutSha256: sha256(run.stdout), stderrBytes: run.stderr.length, synchronousChildReaped: true, timeoutMs: 10000 });
  return run.stdout;
}
for (const [commit, directory] of [[repairCommit, author], [preparationCommit, own]]) {
  const body = git(['cat-file', 'commit', commit]); assert.equal(objectId('commit', body), commit);
  const listing = git(['ls-tree', '-rz', '--full-tree', commit, '--', path.relative(repository, directory)]);
  for (const record of listing.toString('utf8').split('\0').filter(Boolean)) {
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t([^\0]+)$/.exec(record); assert.ok(match);
    const entry = admit(path.join(repository, match[3])); assert.equal(entry.blob, match[2]); assert.equal(entry.mode, match[1] === '100644' ? 0o644 : 0o755);
  }
}
const originalSeal = json(path.join(own, 'PRESEAL.json'));
for (const entry of originalSeal.files) admit(path.join(own, entry.path), entry);
const historical = json(path.join(own, 'SOURCE-INVENTORY.json'));
for (const entry of [...historical.sources, ...historical.data]) admit(path.join(repository, entry.path), entry);
const authorSeal = json(path.join(author, 'PRESEAL.json'));
for (const entry of authorSeal.files) admit(path.resolve(author, entry.path), entry);
admit(path.join(author, 'inventory-v1'));
const metadata = json(path.join(author, 'METADATA.json'));
for (const group of metadata.tools) {
  if (group.directory) admit(path.resolve(repository, group.directory));
  for (const entry of group.entries ?? [group]) admit(path.resolve(repository, entry.path), entry.type === 'directory' ? { mode: entry.mode } : entry);
}
for (const stem of ['001-git-base-tree', '002-git-authenticated-inputs']) {
  const filename = path.join(own, '../actual-v1/evidence', stem + '.json'); admit(filename);
  for (const fragment of json(filename).fragments) admit(path.join(path.dirname(filename), fragment.name));
}
for (const name of ['freeze-review.mjs', 'review-reference.mjs', 'run-review.mjs', 'launch-review.mjs', 'REVIEW-RECIPE.md', 'SOURCE-REVIEW.md']) admit(path.join(own, name));
const seal = { schema: 'independent-repair-runner-preseal-v1', date: '2026-08-28', repairCommit, preparationCommit, productCommit: metadata.candidate, evidenceCommit: metadata.evidence, executionSealSha256: sha256(fs.readFileSync(path.join(author, 'EXECUTION-SEAL.json'))), originalPresealSha256: sha256(fs.readFileSync(path.join(own, 'PRESEAL.json'))), controls: 206, importedCandidateModules: ['path-bytes.mjs', 'capture-io.mjs', 'supervisor.mjs', 'deadline.mjs'], forbiddenDispatches: ['controller', 'product', 'compiler', 'build', 'install', 'native', 'mutant', 'network'], metadataChildren: children, entries: [...entries.values()].sort((left, right) => left.path.localeCompare(right.path)), execution: 'NOT_RUN; commit this seal and runner before launch', limits: { totalMs: 900000, dataChildMs: 30000, metadataChildMs: 10000, captures: 134217728, work: 536870912, serialChildren: true, memoryQualification: 'byte accounting, not RSS or CLI process peak' } };
const destination = path.relative(repository, path.join(own, 'RUNNER-SEAL.json'));
assert.equal(fs.existsSync(path.join(repository, destination)), false);
const patch = `*** Begin Patch\n*** Add File: ${destination}\n${(JSON.stringify(seal, null, 2) + '\n').trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`;
const applied = spawnSync('apply_patch', [], { cwd: repository, input: patch, timeout: 10000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
assert.equal(applied.status, 0, applied.stderr); console.log(JSON.stringify({ files: entries.size, metadataChildren: children.length, executionSealSha256: seal.executionSealSha256, runnerSealSha256: sha256(fs.readFileSync(path.join(own, 'RUNNER-SEAL.json'))) }));
