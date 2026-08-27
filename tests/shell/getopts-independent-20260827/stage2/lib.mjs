import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

export const owned = fileURLToPath(new URL('./', import.meta.url)).replace(/\/$/, '');
export const repository = path.resolve(owned, '../../../..');
export const relative = path.relative(repository, owned);
export const phase1Commit = '4f84fdfd41134710cdb68fab3f5970cb14e54da3';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const git = (...args) => execFileSync('git', args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
export const save = (name, value) => fs.writeFileSync(path.join(owned, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
export function inventory(root, omit = new Set()) {
  const result = {};
  const walk = (directory = '') => {
    for (const name of fs.readdirSync(path.join(root, directory)).sort()) {
      const key = directory ? `${directory}/${name}` : name;
      if (omit.has(key)) continue;
      const filename = path.join(root, key);
      const stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink()) result[key] = { type: 'symlink', target: fs.readlinkSync(filename) };
      else if (stat.isDirectory()) { result[key] = { type: 'directory' }; walk(key); }
      else { const bytes = fs.readFileSync(filename); result[key] = { type: 'file', bytes: bytes.length, sha256: hash(bytes) }; }
    }
  };
  walk();
  return result;
}
export function committedTree(commit, directory, current) {
  const prefix = `${path.relative(repository, directory)}/`;
  const records = git('ls-tree', '-r', '-z', commit, '--', prefix).toString().split('\0').filter(Boolean);
  const expectedFiles = [];
  for (const record of records) {
    const [metadata, filename] = record.split('\t');
    const [mode, type, oid] = metadata.split(' ');
    assert.equal(type, 'blob');
    const local = filename.slice(prefix.length);
    expectedFiles.push(local);
    assert(current[local], `missing committed entry ${local}`);
    const bytes = mode === '120000' ? Buffer.from(fs.readlinkSync(path.join(directory, local))) : fs.readFileSync(path.join(directory, local));
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), oid, `commit bytes ${local}`);
  }
  assert.deepEqual(Object.keys(current).filter(name => current[name].type !== 'directory').sort(), expectedFiles.sort(), 'committed file membership');
  return expectedFiles.length;
}
export function verifyPhase1() {
  const parent = path.dirname(owned);
  const current = inventory(parent, new Set(['stage2']));
  const bytes = fs.readFileSync(path.join(parent, 'review-manifest.json'));
  assert.deepEqual(bytes, git('show', `${phase1Commit}:${path.relative(repository, parent)}/review-manifest.json`), 'original Phase1 manifest bytes');
  const seal = JSON.parse(bytes);
  const sealedEntries = { ...current };
  delete sealedEntries['review-manifest.json'];
  assert.deepEqual(sealedEntries, seal.entries, 'Phase1 exact membership excluding ONLY authorized stage2 subtree');
  const files = committedTree(phase1Commit, parent, current);
  return { originalCommit: phase1Commit, originalManifestSHA256: hash(bytes), files, entries: Object.keys(current).length, excludedSubtrees: ['stage2'], originalBytesAndMembershipMatch: true, checksAddedEntriesOutsideSidecar: true };
}
export const readPaths = [
  'src/shell/runtime.ts', 'src/shell/shell.ts', 'src/shell/parser.ts', 'src/shell/arithmetic.ts', 'src/shell/types.ts',
  'src/contracts/command.md', 'src/contracts/command.ts', 'src/contracts/io.ts',
  'tests/shell/getopts/AUTHOR_HANDOFF.md', 'tests/shell/getopts/README.md', 'tests/shell/getopts/evidence/design-v1/archive.json',
];
export function baseline() {
  const commit = git('rev-parse', 'HEAD').toString().trim();
  const reads = Object.fromEntries(readPaths.map(filename => {
    const bytes = fs.readFileSync(path.join(repository, filename));
    const committed = git('show', `${commit}:${filename}`);
    return [filename, { bytes: bytes.length, sha256: hash(bytes), committedSHA256: hash(committed), matchesCommit: bytes.equals(committed) }];
  }));
  const routingHeader = fs.readFileSync(path.join(repository, 'src/shell/runtime.ts'), 'utf8').split('\n').slice(0, 40).join('\n');
  const shellNames = routingHeader.match(/const shellBuiltinNames = new Set\(\[([\s\S]*?)\]\)/)?.[1];
  assert(shellNames, 'routing metadata shape changed; do not infer support');
  const names = [...shellNames.matchAll(/"([^"]+)"/g)].map(match => match[1]);
  return { observedAt: new Date().toISOString(), commit, reads, registration: names.includes('getopts') ? 'unexpected-stage2-metadata-present' : 'notregistered', builtinDispatcher: names.includes('builtin'), declare: names.includes('declare'), typeset: names.includes('typeset'), names, status: git('status', '--short').toString(), staged: git('diff', '--cached', '--raw').toString(), productExecutions: 0 };
}
export function verifyFreeze() {
  const filename = 'freeze-manifest.json';
  const commit = git('log', '-1', '--format=%H', '--', `${relative}/${filename}`).toString().trim();
  assert(commit, 'freeze must be committed before native execution');
  const bytes = fs.readFileSync(path.join(owned, filename));
  assert.deepEqual(bytes, git('show', `${commit}:${relative}/${filename}`));
  const manifest = JSON.parse(bytes);
  for (const [name, entry] of Object.entries(manifest.files)) {
    const actual = fs.readFileSync(path.join(owned, name));
    assert.equal(hash(actual), entry.sha256, `frozen bytes ${name}`);
    assert.equal(actual.length, entry.bytes);
    assert.deepEqual(actual, git('show', `${commit}:${relative}/${name}`), `freeze commit input ${name}`);
  }
  return { commit, manifestSHA256: hash(bytes), fileCount: Object.keys(manifest.files).length, scripts: manifest.scripts.length, invariants: manifest.invariants.length };
}
export async function execute(binary, args, env) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  return await new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: owned, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = { stdout: [], stderr: [] };
    const counts = { stdout: 0, stderr: 0 };
    let termination = null;
    let spawnError = null;
    const kill = reason => {
      termination ??= reason;
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') spawnError ??= error.message; }
    };
    const timer = setTimeout(() => kill('deadline'), 5000);
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
      counts[stream] += chunk.length;
      if (counts.stdout + counts.stderr > 131072) kill('output-cap');
      else chunks[stream].push(Buffer.from(chunk));
    });
    child.on('error', error => { spawnError = error.message; });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(chunks.stdout);
      const stderr = Buffer.concat(chunks.stderr);
      resolve({ binary, args, cwd: owned, env, stdin: 'closed', startedAt, milliseconds: performance.now() - started, pid: child.pid ?? null, status, signal, termination, spawnError, closeAwaited: true, stdoutBytes: counts.stdout, stderrBytes: counts.stderr, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), stdoutBase64: stdout.toString('base64'), stderrBase64: stderr.toString('base64'), limits: { milliseconds: 5000, combinedOutputBytes: 131072 }, processGroup: 'isolated; killed on bound violation; finite builtin-only scripts otherwise' });
    });
  });
}
