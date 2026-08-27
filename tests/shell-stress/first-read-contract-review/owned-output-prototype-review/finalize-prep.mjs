import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../../..');
const readyPath = '/tmp/safe-bash-owned-output-prototype.ready';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const describe = (name) => {
  const bytes = readFileSync(resolve(owned, name));
  return { path: name, bytes: bytes.length, sha256: hash(bytes) };
};
const writeNew = (name, value) => writeFileSync(resolve(owned, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });

assert.equal(git('rev-parse', '--show-toplevel').toString().trim(), root);
const mode = process.argv[2];
if (mode === 'seal-binding') {
  const originalSeal = readFileSync(resolve(owned, 'intentions-freeze.json'));
  assert.equal(hash(originalSeal), 'aabc0ea5c7d7f03b4c4038b3c94952e7a08d9c98e2d40b9dbbf76417503be972');
  const declaration = readFileSync('/tmp/safe-bash-owned-output-prototype-api.txt');
  assert.ok(declaration.toString().includes('Pre-implementation addendum v1.1:'));
  writeFileSync(resolve(owned, 'author-api-v1.1.txt.data'), declaration, { flag: 'wx' });
  writeNew('binding-freeze.json', {
    frozenAt: new Date().toISOString(),
    classification: 'declaration-only-partial-binding-not-candidate-execution',
    intentionsCommit: 'f412eec',
    intentionsSealSha256: hash(originalSeal),
    declaration: describe('author-api-v1.1.txt.data'),
    binding: ['BINDING.md', 'binding.mjs', 'support.mjs', 'scaffold-check.mjs'].map(describe),
    candidateModuleBinding: null,
    originalAdaptationPatch: null,
    implementationInspected: false,
    authorTestBodiesInspected: false,
    readyPresent: existsSync(readyPath),
  });
  console.log(JSON.stringify(describe('binding-freeze.json'), null, 2));
} else if (mode === 'checks') {
  const binding = JSON.parse(readFileSync(resolve(owned, 'binding-freeze.json'), 'utf8'));
  for (const entry of [binding.declaration, ...binding.binding]) assert.deepEqual(describe(entry.path), entry);
  const commands = [
    ...['freeze.mjs', 'support.mjs', 'binding.mjs', 'scaffold-check.mjs', 'finalize-prep.mjs'].map((name) => ['--check', resolve(owned, name)]),
    [resolve(owned, 'freeze.mjs'), 'verify'],
    ['--unhandled-rejections=strict', '--test', resolve(owned, 'scaffold-check.mjs')],
  ];
  const runs = [];
  for (const [index, args] of commands.entries()) {
    const started = Date.now();
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    const label = `prep-check-${index + 1}`;
    writeFileSync(resolve(owned, `${label}.stdout.data`), result.stdout ?? '', { flag: 'wx' });
    writeFileSync(resolve(owned, `${label}.stderr.data`), result.stderr ?? '', { flag: 'wx' });
    runs.push({
      classification: 'scaffold-only-not-product-test', executable: process.execPath,
      args, cwd: root, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started,
      pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null,
      stdout: describe(`${label}.stdout.data`), stderr: describe(`${label}.stderr.data`),
      synchronouslyReaped: result.status !== null || result.signal !== null,
    });
  }
  writeNew('checks.json', { createdAt: new Date().toISOString(), productExecuted: false, scaffoldUnitChecks: 6, runs });
  assert.ok(runs.every((run) => run.status === 0 && run.signal === null && run.error === null));
  console.log(JSON.stringify({ invocations: runs.length, scaffoldUnitChecks: 6, productCasesExecuted: 0 }, null, 2));
} else if (mode === 'close-prep') {
  assert.equal(existsSync(readyPath), false, 'Ready appeared; inspect root authentication before choosing the next phase');
  const before = JSON.parse(readFileSync(resolve(owned, 'intentions-freeze.json'), 'utf8'));
  const prefix = `${relative(root, owned)}/`;
  const parseEntries = (entries) => new Map(entries.map((entry) => {
    const separator = entry.indexOf('\t');
    return [entry.slice(separator + 1), entry.slice(0, separator)];
  }));
  const initial = parseEntries(before.initialIndexPathEntries);
  const current = parseEntries(git('ls-files', '--stage').toString().split('\n').filter(Boolean));
  const changes = [...new Set([...initial.keys(), ...current.keys()])]
    .filter((path) => !path.startsWith(prefix) && initial.get(path) !== current.get(path))
    .map((path) => ({ path, before: initial.get(path) ?? null, after: current.get(path) ?? null }));
  const ownCommits = ['f412eec'].map((commit) => ({
    commit: git('rev-parse', commit).toString().trim(),
    paths: git('diff-tree', '--no-commit-id', '--name-only', '-r', commit).toString().trim().split('\n'),
  }));
  assert.ok(ownCommits.every((commit) => commit.paths.every((path) => path.startsWith(prefix))));
  writeNew('prep-closure.json', {
    observedAt: new Date().toISOString(), outcome: 'PREPARATION_ONLY_READY_UNAVAILABLE',
    productCasesExecuted: 0, authorReproductionsExecuted: 0, nativeReplaysExecuted: 0,
    candidateRestored: false, compilerAuthenticated: false, originalAdaptationPatchBound: false,
    ready: { path: readyPath, present: false },
    ownCommits, protectedIndexPathChangesObserved: changes,
    protectedIndexNote: 'Concurrent owner changes are observations, not verifier edits. Only own exact-path commit is attributed here; never reset or restore others.',
    checkoutHeadNotCandidate: git('rev-parse', 'HEAD').toString().trim(),
    worktreePathStatus: git('status', '--short', '--untracked-files=normal').toString(),
    stagedNames: git('diff', '--cached', '--name-only').toString(),
    resources: { nativeFixtures: 0, loopbackServers: 0, longLivedChildren: 0, signalsSent: 0, ownedSourceCopies: 0, childChecks: 'All seven synchronous check processes reaped; see checks.json.' },
    actualLeafClosed: 'Not self-attested; root must observe after final return',
  });
  console.log(JSON.stringify({ outcome: 'PREPARATION_ONLY_READY_UNAVAILABLE', protectedConcurrentPathChanges: changes.length }, null, 2));
} else if (mode === 'artifacts') {
  const files = readdirSync(owned).filter((name) => name !== 'artifacts.json').sort();
  assert.ok(files.every((name) => !name.endsWith('.ts')));
  writeNew('artifacts.json', {
    createdAt: new Date().toISOString(), classification: 'inert-preparation-and-maintained-js-only',
    files: files.map(describe), productExecuted: false,
  });
  console.log(JSON.stringify(describe('artifacts.json'), null, 2));
} else {
  throw new Error('Use seal-binding, checks, close-prep or artifacts; no mode executes product');
}
