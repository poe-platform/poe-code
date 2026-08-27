import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, lstatSync, mkdirSync, mkdtempSync, symlinkSync, renameSync, realpathSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, type, release, arch } from 'node:os';
import { join, resolve } from 'node:path';

export const candidateCommit = '85675366efe962c0d52993bb8aa286dc9683f6a6';
export const freezeCommit = '35aa8054ac0ebc1eacefc7cde63e4706f4c72137';
export const authorMarker = 'd96f9ffe7e23488c8b739b4e4fccdc88e13eb2ac';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const json = value => `${JSON.stringify(value, null, 2)}\n`;
export const load = path => JSON.parse(readFileSync(path, 'utf8'));
export function snapshot(root, exclusions = []) {
  const entries = [];
  function walk(directory, prefix = '') {
    for (const name of readdirSync(directory).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      if (exclusions.includes(relative)) continue;
      const path = join(directory, name);
      const stat = lstatSync(path);
      assert(!stat.isSymbolicLink(), `unexpected symlink: ${path}`);
      if (stat.isDirectory()) { entries.push({ path: relative, directory: true }); walk(path, relative); }
      else entries.push({ path: relative, sha256: sha256(readFileSync(path)) });
    }
  }
  walk(root);
  return entries;
}
export function patchNew(path, value, cwd) {
  assert(!existsSync(resolve(cwd, path)), `refusing existing capture: ${path}`);
  const text = typeof value === 'string' ? value : json(value);
  const body = text.replace(/\n$/, '').split('\n').map(line => `+${line}`).join('\n');
  const result = spawnSync('apply_patch', [], { cwd, input: `*** Begin Patch\n*** Add File: ${path}\n${body}\n*** End Patch\n`, encoding: 'utf8', timeout: 15000, maxBuffer: 65536 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}
export function prepare(root) {
  const startedAt = new Date().toISOString();
  const temporary = mkdtempSync(join(tmpdir(), 'expr-nonregex-review-'));
  const npmEnvironment = { PATH: process.env.PATH, HOME: temporary, LANG: 'C', LC_ALL: 'C', npm_config_cache: join(temporary, 'npm-cache'), npm_config_userconfig: join(temporary, 'absent-user-npmrc'), npm_config_globalconfig: join(temporary, 'absent-global-npmrc') };
  const commands = [];
  try {
  function run(executable, args, options = {}) {
    const began = new Date().toISOString();
    const result = spawnSync(executable, args, { cwd: root, timeout: 120000, maxBuffer: 32 * 1024 * 1024, ...options });
    commands.push({ executable, args, cwd: options.cwd ?? root, environment: options.env ?? 'inherited tooling environment; product environment separately explicit', startedAt: began, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: args[0] === 'archive' ? null : result.stdout?.toString() ?? '', stdoutSha256: result.stdout ? sha256(result.stdout) : null, stdoutBytes: result.stdout?.length ?? 0, stderr: result.stderr?.toString() ?? '', inputSha256: options.input ? sha256(options.input) : null });
    return result;
  }
  function required(executable, args, options) {
    const result = run(executable, args, options);
    assert.equal(result.status, 0, `${executable} ${args.join(' ')}\n${result.stderr}`);
    return result.stdout;
  }
  const git = args => required('git', args).toString().trim();
  assert.equal(git(['rev-parse', '--show-toplevel']), root);
  const statusAtStart = git(['status', '--short']);
  const initialIndex = git(['diff', '--cached', '--name-only']);
  for (const commit of [candidateCommit, freezeCommit, authorMarker]) assert.equal(git(['rev-parse', `${commit}^{commit}`]), commit);
  const provenanceMarker = git(['show', '--format=fuller', '--stat', authorMarker]);
  const archivePaths = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
  const archive = required('git', ['archive', '--format=tar', candidateCommit, ...archivePaths]);
  const source = join(temporary, 'candidate');
  mkdirSync(source);
  required('/usr/bin/tar', ['-xf', '-', '-C', source], { input: archive });
  const before = snapshot(source);
  const frozenRoot = join(temporary, 'freeze');
  mkdirSync(frozenRoot);
  const freezeArchive = required('git', ['archive', '--format=tar', freezeCommit, 'tests/commands/expr-stress/frozen']);
  required('/usr/bin/tar', ['-xf', '-', '-C', frozenRoot], { input: freezeArchive });
  const frozen = join(frozenRoot, 'tests/commands/expr-stress/frozen');
  const frozenBefore = snapshot(frozen);
  assert.deepEqual(snapshot(join(root, 'tests/commands/expr-stress/frozen')), frozenBefore);
  const freezeRunner = readFileSync(join(frozen, 'runner.mjs.data'));
  required(process.execPath, ['--input-type=module', '-', 'verify'], { input: freezeRunner });
  required(process.execPath, ['--input-type=module', '-', 'verify-native'], { input: freezeRunner });
  symlinkSync(join(root, 'node_modules'), join(source, 'node_modules'), 'dir');
  const compiler = realpathSync(join(root, 'node_modules/typescript/bin/tsc'));
  required(process.execPath, [compiler, '-p', 'tsconfig.build.json'], { cwd: source });
  required(process.execPath, [compiler, '-p', 'tsconfig.build.json', '--noEmit'], { cwd: source });
  assert.deepEqual(snapshot(source, ['node_modules', 'dist']), before);
  const built = snapshot(join(source, 'dist'));
  const packed = JSON.parse(required('npm', ['pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', temporary], { cwd: source, env: npmEnvironment }).toString());
  const tarball = join(temporary, packed[0].filename);
  const install = join(temporary, 'install-original');
  mkdirSync(install);
  patchNew('package.json', { name: 'independent-expr-consumer', version: '0.0.0', private: true, type: 'module' }, install);
  required('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball], { cwd: install, env: npmEnvironment });
  const moved = join(temporary, 'moved-offline-consumer');
  renameSync(install, moved);
  const retiredSource = join(temporary, 'archived-source-not-a-resolution-root');
  renameSync(source, retiredSource);
  const installed = join(moved, 'node_modules/virtual-bash');
  const packageJson = load(join(installed, 'package.json'));
  assert.deepEqual(packageJson.dependencies ?? {}, {});
  assert.equal(packageJson.name, 'virtual-bash');
  assert(!packageJson.exports['./commands/expr']);
  assert.deepEqual(snapshot(join(installed, 'dist')), built);
  const provenance = {
    schema: 1, startedAt, root, temporary, candidateCommit, freezeCommit, authorMarker, provenanceMarker,
    candidateDirty: false, liveStatusNotCandidateInput: statusAtStart, initialIndex,
    sourceGitTree: git(['rev-parse', `${candidateCommit}:src`]), sourceTreeSha256: sha256(json(before.filter(entry => entry.path === 'src' || entry.path.startsWith('src/')))),
    candidateArchiveSha256: sha256(archive), archivePaths, candidateSourceManifest: before,
    freezeArchiveSha256: sha256(freezeArchive), frozenManifest: frozenBefore,
    freezeReceipt: readFileSync('/tmp/expr-independent-freeze-candidate.txt', 'utf8'),
    freezeReceiptSha256: sha256(readFileSync('/tmp/expr-independent-freeze-candidate.txt')),
    builtManifest: built, installedPackage: installed, tarballSha256: sha256(readFileSync(tarball)), packed,
    host: { type: type(), release: release(), arch: arch(), node: process.version },
    tooling: { compiler, compilerSha256: sha256(readFileSync(compiler)), typescript: load(join(root, 'node_modules/typescript/package.json')).version, nodeExecutable: realpathSync(process.execPath), nodeExecutableSha256: sha256(readFileSync(process.execPath)), npm: required('npm', ['--version'], { env: npmEnvironment }).toString().trim(), npmEnvironment },
    commands,
  };
  return { root, temporary, frozen, frozenBefore, retiredSource, sourceBefore: before, built, installed, moved, compiler, provenance, run, required };
  } catch (error) {
    console.error(json({ preparationFailure: String(error), temporary, commands }));
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}
