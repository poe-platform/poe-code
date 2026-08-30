import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { arch, platform, release, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const candidate = 'f1a90436c45208ca248e058a039893233c608daa';
const oracleRoot = '/tmp/safe-bash-tree-oracle-MlUjmM';
const binary = join(oracleRoot, 'unix-tree-2.2.1/tree');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const invoke = (command, args, cwd, env, input) => {
  const result = spawnSync(command, args, { cwd, env, input, timeout: 15000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.signal) throw result.error ?? new Error(result.signal);
  return { exitCode: result.status, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
};
const controlledEnvironment = { PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC' };
const git = args => {
  const result = invoke('/usr/bin/git', args, repository, controlledEnvironment);
  assert.equal(result.exitCode, 0, result.stderr);
  return result.stdout;
};
const source = git(['ls-tree', '-r', candidate, '--', 'src']).trim().split('\n');
assert.ok(source.every(row => row.startsWith('100644 blob ')), 'source archive must contain regular files only');
const frozenFiles = source.map(row => row.split('\t')[1]);
const scratch = await mkdtemp(join(tmpdir(), 'safe-bash-tree-breadth-proposal-'));
const inventory = async root => {
  const rows = [];
  const visit = async relative => {
    for (const name of (await readdir(join(root, relative))).sort()) {
      const child = join(relative, name);
      const stat = await lstat(join(root, child));
      if (stat.isSymbolicLink()) rows.push([child, 'symlink', await readlink(join(root, child))]);
      else if (stat.isDirectory()) { rows.push([child, 'directory']); await visit(child); }
      else { assert.ok(stat.isFile()); rows.push([child, 'file', hash(await readFile(join(root, child)))]); }
    }
  };
  await visit('');
  return rows;
};
try {
  const nativeProvenance = JSON.parse(git(['show', `${candidate}:tests/commands/tree/native-fixtures.json`])).provenance;
  assert.equal(hash(await readFile(binary)), nativeProvenance.binarySha256);
  const archive = join(oracleRoot, 'tree-2.2.1.tar.bz2');
  assert.equal(hash(await readFile(archive)), nativeProvenance.archiveSha256);
  const primaryFiles = [];
  for (const name of ['list.c', 'tree.c', 'color.c', 'CHANGES', 'doc/tree.1']) {
    const result = spawnSync('/usr/bin/tar', ['-xOf', archive, `unix-tree-2.2.1/${name}`], { timeout: 15000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0);
    assert.deepEqual(await readFile(join(oracleRoot, 'unix-tree-2.2.1', name)), result.stdout);
    primaryFiles.push({ name, sha256: hash(result.stdout) });
  }
  const copied = join(scratch, 'candidate');
  await mkdir(copied);
  const archiveResult = spawnSync('/usr/bin/git', ['archive', candidate, 'src'], { cwd: repository, timeout: 15000, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(archiveResult.status, 0);
  assert.equal(invoke('/usr/bin/tar', ['-xf', '-', '-C', copied], scratch, controlledEnvironment, archiveResult.stdout).exitCode, 0);
  const sourceBefore = await inventory(join(copied, 'src'));
  const esbuild = join(repository, 'node_modules/@esbuild/darwin-arm64/bin/esbuild');
  const esbuildHash = hash(await readFile(esbuild));
  const entry = 'export {createTreeCommand} from "./src/commands/tree/index.ts"; export {createMemoryFileSystem} from "./src/fs/memory/index.ts"; export {Shell} from "./src/shell/index.ts"; export {agentCommands} from "./src/plugins/index.ts";';
  const built = invoke(esbuild, ['--bundle', '--platform=node', '--format=esm', '--sourcefile=probe-entry.ts', '--outfile=product.mjs', '--metafile=inputs.json'], copied, controlledEnvironment, entry);
  assert.equal(built.exitCode, 0, built.stderr);
  const loaded = Object.keys(JSON.parse(await readFile(join(copied, 'inputs.json'))).inputs).filter(name => name !== 'probe-entry.ts');
  assert.ok(loaded.every(name => frozenFiles.includes(name)), 'bundle must use only committed source modules');
  const productHash = hash(await readFile(join(copied, 'product.mjs')));
  const { createTreeCommand, createMemoryFileSystem, Shell, agentCommands } = await import(pathToFileURL(join(copied, 'product.mjs')).href);
  const fixture = join(scratch, 'fixture');
  await mkdir(fixture);
  const directories = ['tree-input', 'tree-input/sub', 'empty', 'files', 'hidden', 'dirs', 'dirs/empty', 'unicode', 'links'];
  const files = { 'tree-input/a.txt': 'a\n', 'tree-input/sub/b.txt': 'b\n', 'files/one': 'one', 'hidden/.secret': 'secret', 'unicode/é.txt': '', 'unicode/雪.txt': '', 'unicode/line\nfeed': '' };
  const links = { 'links/dir': '../tree-input/sub', 'links/broken': 'absent' };
  const fs = createMemoryFileSystem();
  for (const directory of directories) { await mkdir(join(fixture, directory)); await fs.mkdir(`/${directory}`); }
  for (const [name, value] of Object.entries(files)) { await writeFile(join(fixture, name), value); await fs.writeFile(`/${name}`, new TextEncoder().encode(value)); }
  for (const [name, target] of Object.entries(links)) { await symlink(target, join(fixture, name)); await fs.symlink(target, `/${name}`); }
  const fixtureBefore = await inventory(fixture);
  const rows = [];
  const capture = async (id, args, env) => {
    const native = invoke(binary, ['-n', ...args], fixture, { PATH: '/usr/bin:/bin', HOME: fixture, TZ: 'UTC', ...env });
    const stdout = [], stderr = [];
    const result = await createTreeCommand().execute({ command: 'tree', args, cwd: '/', env, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { throw new Error('tree must not consume stdin'); } },
      stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } } });
    const virtual = { exitCode: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
    rows.push({ id, args, env, native, virtual, exactMatch: JSON.stringify(native) === JSON.stringify(virtual) });
  };
  for (const [id, env, args = []] of [
    ['C', { LC_ALL: 'C' }], ['POSIX', { LC_ALL: 'POSIX' }], ['unset', {}],
    ['utf8-all', { LC_ALL: 'en_US.UTF-8' }], ['utf8-lang', { LANG: 'en_US.UTF-8' }],
    ['ctype-precedence', { LANG: 'C', LC_CTYPE: 'en_US.UTF-8' }],
    ['all-precedence', { LC_ALL: 'C', LC_CTYPE: 'en_US.UTF-8', LANG: 'en_US.UTF-8' }],
    ['empty-all', { LC_ALL: '', LANG: 'en_US.UTF-8' }],
    ['tree-utf8', { LC_ALL: 'C', TREE_CHARSET: 'UTF-8' }],
    ['tree-ascii', { LC_ALL: 'en_US.UTF-8', TREE_CHARSET: 'ASCII' }],
    ['tree-empty', { LC_ALL: 'en_US.UTF-8', TREE_CHARSET: '' }],
    ['tree-unknown', { LC_ALL: 'en_US.UTF-8', TREE_CHARSET: 'not-a-charset' }],
    ['explicit-utf8', { LC_ALL: 'C', TREE_CHARSET: 'ASCII' }, ['--charset=UTF-8']],
    ['explicit-ascii', { LC_ALL: 'en_US.UTF-8', TREE_CHARSET: 'UTF-8' }, ['--charset=ASCII']],
    ['invalid-locale', { LC_ALL: 'not-installed.UTF-8' }],
  ]) await capture(`charset-${id}`, [...args, 'tree-input'], env);
  for (const [id, args] of [
    ['empty', ['empty']], ['files', ['files']], ['empty-child', ['dirs']], ['hidden', ['hidden']],
    ['hidden-visible', ['-a', 'hidden']], ['filtered-all', ['-I', '*', 'tree-input']],
    ['files-filtered', ['-P', 'none', 'files']], ['directories-only-files', ['-d', 'files']],
    ['directories-only-tree', ['-d', 'tree-input']], ['level-one', ['-L1', 'tree-input']],
    ['repeat', ['tree-input', 'tree-input']], ['mixed-roots', ['empty', 'tree-input', 'files/one']],
    ['json', ['-Ji', 'tree-input']], ['links', ['links']], ['follow-links', ['-l', 'links']],
  ]) await capture(`count-${id}`, args, { LC_ALL: 'C' });
  for (const [id, env, args] of [
    ['c', { LC_ALL: 'C' }, []], ['utf8', { LC_ALL: 'en_US.UTF-8' }, []],
    ['c-utf8-branches', { LC_ALL: 'C' }, ['--charset=UTF-8']],
    ['utf8-ascii-branches', { LC_ALL: 'en_US.UTF-8' }, ['--charset=ASCII']],
  ]) await capture(`names-${id}`, [...args, 'unicode'], env);
  const shell = new Shell({ fs, cwd: '/', env: { LC_ALL: 'C', LANG: 'C' } }).use(agentCommands());
  let shellResult;
  try { shellResult = await shell.exec('tree tree-input'); } finally { await shell.dispose(); }
  assert.equal(shellResult.stdout, rows[0].virtual.stdout);
  const sourceAfter = await inventory(join(copied, 'src'));
  assert.deepEqual(sourceAfter, sourceBefore);
  assert.deepEqual(await inventory(fixture), fixtureBefore);
  for (const [name, value] of Object.entries(files)) assert.deepEqual(await fs.readFile(`/${name}`), new TextEncoder().encode(value));
  assert.equal(hash(await readFile(binary)), nativeProvenance.binarySha256);
  assert.equal(hash(await readFile(esbuild)), esbuildHash);
  const result = { candidate, node: { path: process.execPath, version: process.version, sha256: hash(await readFile(process.execPath)) }, platform: `${platform()} ${arch()} ${release()}`,
    native: { binary, ...nativeProvenance, primaryFiles }, sourceArchiveSha256: hash(archiveResult.stdout), sourceBefore, loaded,
    esbuild: { path: esbuild, sha256: esbuildHash }, productHash, cases: rows.length, exactMatches: rows.filter(row => row.exactMatch).length,
    shellResult, rows, sourceAndFixtureImmutability: 'exact pre/post census including new entries', virtualFileContentsPreserved: true,
    limitation: 'Virtual content readback is not a full virtual namespace/mode census. Existing native build provenance corroborated, not freshly rebuilt or independently network-attested.' };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally { await rm(scratch, { recursive: true, force: true }); }
