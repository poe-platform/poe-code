import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { platform, release, arch } from 'node:os';
import { cases, environment, fixtures, rules } from './corpus.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = '/Users/kjopek/Workspace/safe-bash';
const originalOracle = '/tmp/safe-bash-tree-oracle-MlUjmM';
const oracleSource = join(originalOracle, 'unix-tree-2.2.1');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const nativeRoot = join(directory, 'native-fixtures');
await mkdir(nativeRoot, { mode: 0o700 });
await mkdir(join(directory, 'oracle'), { mode: 0o700 });
await mkdir(join(directory, 'inputs'), { mode: 0o700 });
const inputs = [];
for (const relative of ['AGENTS.md', 'src/contracts/command.ts', 'src/contracts/command.md', 'src/contracts/filesystem.ts', 'src/contracts/filesystem.md', 'src/contracts/io.ts', 'src/contracts/errors.ts', 'src/contracts/plugin.ts', 'src/contracts/path.ts']) {
  const bytes = await readFile(join(repository, relative));
  inputs.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) });
  await writeFile(join(directory, 'inputs', relative.replaceAll('/', '__')), bytes, { flag: 'wx', mode: 0o600 });
}
for (const [source, target] of [['tree', 'tree'], ['doc/tree.1', 'tree.1'], ['Makefile', 'Makefile']]) {
  await copyFile(join(oracleSource, source), join(directory, 'oracle', target));
}
await copyFile(join(originalOracle, 'tree-2.2.1.tar.bz2'), join(directory, 'oracle', 'tree-2.2.1.tar.bz2'));
for (const [root, entries] of Object.entries(fixtures)) {
  if (root !== 'rootlink') await mkdir(join(nativeRoot, root), { recursive: true });
  for (const [kind, name, value] of entries) {
    const destination = join(nativeRoot, root, name);
    await mkdir(dirname(destination), { recursive: true });
    if (kind === 'd') await mkdir(destination, { recursive: true });
    if (kind === 'f') await writeFile(destination, value, { flag: 'wx' });
    if (kind === 'l') await symlink(value, destination);
  }
}
const oracle = join(directory, 'oracle', 'tree');
const run = (argv) => {
  const result = spawnSync(oracle, argv, { cwd: nativeRoot, env: environment, input: Buffer.alloc(0), timeout: 2500, maxBuffer: 256 * 1024 });
  assert.equal(result.error, undefined, `bounded native run failed: ${argv}`);
  assert.equal(result.signal, null);
  return { exitCode: result.status, stdoutBase64: result.stdout.toString('base64'), stderrBase64: result.stderr.toString('base64'), stdoutSha256: hash(result.stdout), stderrSha256: hash(result.stderr) };
};
const native = cases.filter((entry) => entry.kind === 'native').map((entry) => ({ id: entry.id, argv: entry.argv, ...run(entry.argv) }));
await writeFile(join(directory, 'native.json'), `${JSON.stringify(native, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
const sourceFiles = (await readdir(oracleSource)).filter((name) => /\.[ch]$/u.test(name) || name === 'Makefile').sort();
const oracleHashes = [];
for (const name of sourceFiles) oracleHashes.push({ path: name, sha256: hash(await readFile(join(oracleSource, name))) });
const nativeDirectoryEntries = {};
for (const root of Object.keys(fixtures)) nativeDirectoryEntries[root] = await readdir(join(nativeRoot, root));
const git = (args) => spawnSync('git', args, { cwd: repository, encoding: 'utf8' }).stdout.trim();
const provenance = {
  preparedAt: new Date().toISOString(), repository, headAtCapture: git(['rev-parse', 'HEAD']),
  statusAtCapture: git(['status', '--short']), indexAtCapture: git(['diff', '--cached', '--name-only']),
  scope: 'NEW tests/commands/filesystem-inspection-stress/tree/** plus private owned /tmp only; no staging/commit',
  phase: 'PREP: no product execution, new plugin imports, author implementation reads, or author test reads',
  host: { platform: platform(), release: release(), arch: arch(), node: process.version },
  oracle: {
    originalOracle, copiedExistingBinary: true, downloadedOrBuiltByVerifier: false, version: run(['--version']),
    binarySha256: hash(await readFile(oracle)), archiveSha256: hash(await readFile(join(directory, 'oracle', 'tree-2.2.1.tar.bz2'))),
    manualSha256: hash(await readFile(join(directory, 'oracle', 'tree.1'))), sourceFiles: oracleHashes,
    buildProvenance: 'Existing author/root-staged binary. No build log inspected or independently rebuilt; compiler flags and exact binary-to-archive reproducibility UNVERIFIED pending root provenance.',
    profile: { environment, commonArgv: ['-n', '--charset=ASCII'], timeoutMs: 2500, maxBufferBytes: 262144, fixtureRoot: nativeRoot, stdin: 'empty', terminal: false },
    primaryWebSources: [
      'https://gitlab.com/OldManProgrammer/unix-tree/-/raw/2.2.1/doc/tree.1',
      'https://gitlab.com/OldManProgrammer/unix-tree/-/tags/2.2.1',
      'https://oldmanprogrammer.net/source.php?dir=projects%2Ftree%2Fdoc%2F%2Ftree.1',
    ],
    manualPolicy: 'Pinned 2.2.1 raw manual is authoritative for this oracle. Current upstream manual identifies 2.3.2 and is not substituted. No latest-version claim.',
  },
  inputs, nativeDirectoryEntries, rules, intendedCases: cases,
  productRuns: 0, productResults: 'NOT RUN', nativeCaptures: native.length,
  unsupported: 'Final API and supported profile pending; unsupported cases remain in denominator and are not passes.',
  limitations: ['No deployed remote providers', 'No performance or memory comparison', 'No full native parity', 'No product subprocess/dependency audit yet', 'Same-user files are hidden by coordination, not an OS security boundary'],
};
await writeFile(join(directory, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ directory, cases: cases.length, nativeCaptures: native.length, productRuns: 0, nativeFixtureDevice: (await stat(nativeRoot)).dev }, null, 2));
