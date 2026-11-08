import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, lstatSync, readlinkSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const owned = dirname(fileURLToPath(import.meta.url));
export const root = resolve(owned, '../../../..');
export const work = join(owned, '.work');
export const candidate = '4f01c1593486c1abff3b007f9a3b16923b88559f';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function inventory(base) {
  const entries = [];
  function walk(directory) {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name), stat = lstatSync(path), entry = { path: relative(base, path), mode: stat.mode & 0o777 };
      if (stat.isSymbolicLink()) entries.push({ ...entry, type: 'symlink', target: readlinkSync(path) });
      else if (stat.isDirectory()) { entries.push({ ...entry, type: 'directory' }); walk(path); }
      else { assert(stat.isFile()); entries.push({ ...entry, type: 'file', bytes: stat.size, sha256: hash(readFileSync(path)) }); }
    }
  }
  walk(base);
  return entries;
}
export function save(name, value) {
  writeFileSync(join(owned, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}
export function command(name, executable, args, options = {}) {
  const started = new Date().toISOString();
  const result = spawnSync(executable, args, { cwd: work, encoding: 'utf8', timeout: 240000, maxBuffer: 32 * 1024 * 1024, ...options });
  const observation = { name, executable, args, cwd: options.cwd ?? work, started, finished: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr };
  save(`${name}.json`, observation);
  return observation;
}
export function git(...args) {
  const result = spawnSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert(!existsSync(work)); mkdirSync(work);
  const commits = Object.fromEntries(['4f01c159', '246aa440', 'be72c9c8', 'be72c9c8^', 'c433d023', '47309c0b', 'e9ff18dc'].map(ref => [ref, git('rev-parse', ref).toString().trim()]));
  for (const ref of ['246aa440', 'be72c9c8', '47309c0b', 'e9ff18dc']) git('merge-base', '--is-ancestor', ref, candidate);
  const legacyPath = 'tests/commands/expr-stress/diagnostics-candidate-review/replay/legacy-plan.json';
  const legacy = JSON.parse(git('show', `${candidate}:${legacyPath}`));
  const paths = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'tests/commands/expr', 'tests/commands/expr-author/regex-audit-cases.ts', ...legacy.args.filter(arg => arg.endsWith('.ts')),
    ...['named-profile-design-20260827', 'sequencing-design-20260827', 'c-profile-gap-review/frozen', 'diagnostics-review/freeze', 'diagnostics-candidate-review/freeze', 'frozen', 'extension-review/frozen'].map(path => `tests/commands/expr-stress/${path}`), legacyPath];
  const known = git('ls-tree', '-r', '--name-only', candidate).toString().trim().split('\n');
  paths.push(...known.filter(path => /^tests\/commands\/expr-stress\/diagnostics-candidate-review\/(?:replay\/)?[^/]+\.mjs$/.test(path)));
  const selected = paths.filter(path => known.some(entry => entry === path || entry.startsWith(`${path}/`)));
  const archive = git('archive', '--format=tar', candidate, ...selected);
  writeFileSync(join(work, 'candidate.tar'), archive, { flag: 'wx' });
  const source = join(work, 'source'); mkdirSync(source);
  assert.equal(command('extract', '/usr/bin/tar', ['-xf', join(work, 'candidate.tar'), '-C', source]).status, 0);
  const before = inventory(source);
  save('archive-before.json', before);
  save('source-before.json', inventory(join(source, 'src')));
  const authenticated = before.filter(entry => entry.type === 'file').map(entry => {
    const expected = hash(git('show', `${candidate}:${entry.path}`));
    assert.equal(entry.sha256, expected, entry.path);
    return { path: entry.path, sha256: expected };
  });
  for (const [ref, directory] of [['47309c0b', 'named-profile-design-20260827'], ['e9ff18dc', 'sequencing-design-20260827']]) {
    const prefix = `tests/commands/expr-stress/${directory}/`;
    const frozenPaths = git('ls-tree', '-r', '--name-only', ref, '--', prefix).toString().trim().split('\n');
    for (const path of frozenPaths) assert.equal(authenticated.find(entry => entry.path === path)?.sha256, hash(git('show', `${ref}:${path}`)), path);
    save(`${directory}-authentication.json`, { ref: commits[ref], frozen: frozenPaths.map(path => authenticated.find(entry => entry.path === path)), laterCandidateEntries: authenticated.filter(entry => entry.path.startsWith(prefix) && !frozenPaths.includes(entry.path)) });
  }
  const build = command('build-strict', process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(source, 'tsconfig.build.json'), '--skipLibCheck', 'false'], { cwd: source });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const compiled = inventory(join(source, 'dist')); save('compiled-before.json', compiled);
  const pack = command('pack', 'npm', ['pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', work], { cwd: source });
  assert.equal(pack.status, 0);
  const artifact = join(work, JSON.parse(pack.stdout)[0].filename);
  const consumer = join(work, 'consumer'); mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), '{"type":"module","private":true}\n', { flag: 'wx' });
  const install = command('offline-install', 'npm', ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--package-lock=false', '--cache', join(work, 'npm-cache'), artifact], { cwd: consumer });
  assert.equal(install.status, 0, install.stderr);
  const moved = join(work, 'moved-consumer'); renameSync(consumer, moved);
  const installed = join(moved, 'node_modules/virtual-bash');
  assert(!existsSync(consumer));
  assert(!existsSync(join(installed, 'src')));
  assert.deepEqual(inventory(join(installed, 'dist')), compiled);
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json')));
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
  assert(!manifest.exports['./commands/expr']);
  save('installed-before.json', inventory(installed));
  const fixture = `import { createExprCommand, exprCommands } from './node_modules/virtual-bash/dist/commands/expr/index.js';\nimport { Shell } from './node_modules/virtual-bash/dist/shell/shell.js';\nimport { createMemoryFileSystem } from './node_modules/virtual-bash/dist/fs/memory/index.js';\nimport type { CommandContext } from './node_modules/virtual-bash/dist/contracts/index.js';\nconst command = createExprCommand({ limits: { maxSteps: 10000 } });\nconst shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: 'en_US.UTF-8' } }).use(exprCommands());\nexport const execute = (context: CommandContext) => command.execute(context);\nexport const result = shell.exec('expr length é');\n`;
  writeFileSync(join(moved, 'consumer.ts'), fixture, { flag: 'wx' });
  const strict = command('moved-consumer-strict', process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', 'false', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2023', '--types', 'node', '--typeRoots', join(root, 'node_modules/@types'), join(moved, 'consumer.ts')]);
  assert.equal(strict.status, 0, strict.stdout + strict.stderr);
  save('provenance.json', { candidate, commits, selected, exclusions: 'Full repository is 2GB; only declared candidate archive paths are qualified. No unpromoted repeat patch, live source, global dist or root/package export changes.', archiveSha256: hash(archive), archiveBytes: archive.length, authenticated, source, installed, artifactSha256: hash(readFileSync(artifact)), consumerFixtureSha256: hash(fixture), node: process.version, platform: process.platform, arch: process.arch, tooling: ['typescript/lib/typescript.js', 'tsx/package.json', '@types/node/package.json'].map(path => ({ path, sha256: hash(readFileSync(join(root, 'node_modules', path))) })), runtimeDependencies: manifest.dependencies ?? {}, publicExprExport: false, moved: true });
  console.log(JSON.stringify({ candidate, source, installed, files: authenticated.length, compiled: compiled.length }));
}
