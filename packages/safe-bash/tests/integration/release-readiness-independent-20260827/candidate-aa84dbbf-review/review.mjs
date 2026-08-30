import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const repository = '/Users/kjopek/Workspace/safe-bash';
export const scratch = realpathSync(process.argv[2]);
export const candidate = join(scratch, 'candidate');
export const frozen = join(scratch, 'frozen/tests/integration/release-readiness-independent-20260827');
export const evidence = join(scratch, 'evidence');
export const revision = '522e8e273573517ab8b854636bdd4589ee696c28';
export const productRevision = 'c355751f36ca3fdbab8f888eaab30203c1bcd343';
export const freezeRevision = '0895926bbf0f3cf1439c75f59e5505330afa1a39';
export const node = '/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const save = (name, value) => writeFileSync(join(evidence, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
export const git = args => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repository, maxBuffer: 128 * 1024 * 1024 });
export const load = path => import(pathToFileURL(join(candidate, path)).href);
export const base = 'tests/integration/full-gate-20260827/';
export const environment = { ...process.env, GIT_DIR: join(repository, '.git'), GIT_WORK_TREE: candidate, GIT_INDEX_FILE: join(scratch, 'candidate.index'), GIT_OPTIONAL_LOCKS: '0', PATH: dirname(node) + ':/usr/bin:/bin', TSX_DISABLE_CACHE: '1', NODE_OPTIONS: '', TMPDIR: scratch, npm_config_offline: 'true', npm_config_ignore_scripts: 'true' };
export function capture(label, executable, args, options = {}) {
  const started = new Date().toISOString();
  const result = spawnSync(executable, args, { cwd: candidate, env: environment, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024, ...options });
  save(label + '.stdout', result.stdout ?? ''); save(label + '.stderr', result.stderr ?? '');
  const receipt = { label, executable, executableSha256: existsSync(executable) ? sha(readFileSync(executable)) : null, args, cwd: options.cwd ?? candidate, started, finished: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message ?? null, stdoutSha256: sha(result.stdout ?? ''), stderrSha256: sha(result.stderr ?? '') };
  save(label + '.json', receipt); console.log(label, result.status, result.signal, result.error?.message ?? '');
  return { ...receipt, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
export function inventory(root) {
  const entries = [];
  function visit(path) {
    const absolute = join(root, path), stat = lstatSync(absolute), entry = { path, mode: stat.mode & 0o7777 };
    if (stat.isSymbolicLink()) entries.push({ ...entry, kind: 'symlink', target: readlinkSync(absolute) });
    else if (stat.isDirectory()) { entries.push({ ...entry, kind: 'directory' }); for (const name of readdirSync(absolute).sort()) visit(path ? path + '/' + name : name); }
    else { assert.ok(stat.isFile()); entries.push({ ...entry, kind: 'file', sha256: sha(readFileSync(absolute)), bytes: stat.size }); }
  }
  visit(''); return entries;
}
export function authenticateTree(ref, root, prefix = '') {
  const entries = git(['ls-tree', '-rz', ref, ...(prefix ? [prefix] : [])]).toString().split('\0').filter(Boolean).map(row => {
    const split = row.indexOf('\t'), [mode, type, blob] = row.slice(0, split).split(' '), path = row.slice(split + 1);
    const actual = join(root, path), stat = lstatSync(actual);
    const bytes = mode === '120000' ? Buffer.from(readlinkSync(actual)) : readFileSync(actual);
    const actualBlob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(type, 'blob'); assert.equal(actualBlob, blob, path);
    assert.equal(mode, stat.isSymbolicLink() ? '120000' : stat.mode & 0o111 ? '100755' : '100644', path);
    return { path, mode, blob, sha256: sha(bytes) };
  });
  return entries;
}
async function main() {
  Object.assign(process.env, environment);
  const binding = JSON.parse(readFileSync(join(evidence, 'binding.json')));
  assert.equal(binding.revision, revision); assert.equal(binding.files.length, 20);
  const before = authenticateTree(revision, candidate);
  const observed = new Map(before.map(entry => [entry.path, entry]));
  const exact = binding.files.map(entry => { const actual = observed.get(entry.path); assert.equal(actual.blob, entry.gitBlob); assert.equal(actual.sha256, entry.sha256); return { ...entry, mode: actual.mode, revision, latestSourceCommit: git(['log', '-1', '--format=%H', revision, '--', entry.path]).toString().trim() }; });
  save('exact20-authentication.json', { bindingCommit: 'aa84dbbfae5c2f394dc1ec2516a809d659f72b4a', bindingSha256: sha(readFileSync(join(evidence, 'binding.json'))), revision, tree: git(['rev-parse', revision + '^{tree}']).toString().trim(), files: exact, outsiders: 'Every archive entry authenticated against exact 522e8e27; no live overlays.', sourceAncestry: binding.sourceCommits.map(commit => ({ commit, isAncestor: spawnSync('git', ['merge-base', '--is-ancestor', commit, revision], { cwd: repository }).status === 0 })) });
  save('candidate-git-inputs.json', before);
  const frozenInputs = authenticateTree(freezeRevision, join(scratch, 'frozen'), 'tests/integration/release-readiness-independent-20260827');
  assert.equal(frozenInputs.length, 31); save('frozen31-authentication.json', frozenInputs);
  save('candidate-before-setup.json', inventory(candidate));
  save('frozen-before.json', inventory(frozen));
  const runtime = await load(base + 'runtime-profile-20260827/profile.mjs');
  const receipt = runtime.inspectRuntime(node); save('runtime-identity.json', receipt); assert.equal(receipt.supported, true);
  cpSync(join(repository, 'node_modules'), join(candidate, 'node_modules'), { recursive: true, dereference: true });
  save('candidate-after-setup.json', inventory(candidate));
  capture('scratch-index', '/usr/bin/git', ['read-tree', revision]);
  capture('frozen-capture', node, [join(frozen, 'record.mjs'), '--capture', 'independent-aa84dbbf']);
  capture('frozen-verify', node, [join(frozen, 'record.mjs'), '--verify', 'independent-aa84dbbf']);
  for (const [label, paths] of [
    ['native-controls', ['native-recovery-73/controls.test.mjs']],
    ['integrity-controls', ['integrity-73/controls.test.mjs', 'integrity-73/runner-controls.test.mjs']],
    ['profile-controls', ['candidate-profile-73/controls.test.mjs']],
  ]) capture(label, node, ['--test', '--test-reporter=tap', ...paths.map(path => base + path)]);
  capture('integrity-mutants', node, [base + 'integrity-73/mutations.mjs']);
  capture('count-migration-driver', node, [base + 'registry-73-migration/run.mjs']);
  capture('consumer-smoke-driver', node, [base + 'consumer-inventory-73/run.mjs']);
  save('candidate-after-drivers.json', inventory(candidate));
  assert.deepEqual(inventory(candidate), JSON.parse(readFileSync(join(evidence, 'candidate-after-setup.json'))));
  console.log('Candidate setup baseline preserved including additions.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
