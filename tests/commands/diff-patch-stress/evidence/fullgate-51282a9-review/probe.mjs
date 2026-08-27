import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as host from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { base, hash, save } from './replay.mjs';

const label = process.argv[2] ?? 'initial';
const directory = resolve(base, '.scratch', label);
const load = path => import(pathToFileURL(resolve(directory, path)).href);
const { MemoryFileSystem, Shell, diffPatchCommands } = await load('src/index.ts');
const { vectors, decoys } = await load('tests/commands/diff-patch-stress/emptyfile-delta/vectors.ts');
const { oracleIdentity } = await load('tests/commands/diff-patch-stress/gnu-target/oracle.ts');
const profiles = ['gnu', 'apple-calibration'].map(profile => ({ profile, ...oracleIdentity('patch', profile) }));
const frozen = JSON.parse(await host.readFile(`${base}/initial-freeze.json`, 'utf8'));
const failedNames = new Set(frozen.failures.filter(row => row.classification === 'directory-nlink-expectation').map(row => row.name.replace('GNU default: ', '')));
const replace = (path, before = 'old', after = 'new') => `--- ${path}\n+++ ${path}\n@@ -1 +1 @@\n-${before}\n+${after}\n`;
const repeated = replace('first', 'keep', 'changed') + replace('target') + '@@ -1 +1 @@\n-old\n+other\n';
const cases = vectors.filter(vector => failedNames.has(vector.name)).map(vector => ({ name: vector.name, cohort: 'original', args: vector.args, input: vector.input, files: { ...Object.fromEntries(Object.entries(decoys).map(([name, bytes]) => [`/work/${name}`, bytes])), '/authorized/target': vector.initial }, directories: ['/work', '/authorized'] }));
cases.push({ name: 'quoted ancestor symlink', cohort: 'original', args: [], input: replace('first') + replace('"alias/target"'), files: { '/work/first': 'old\n', '/work/target': 'old\n', '/work/dir/target': 'old\n' }, directories: ['/work', '/work/dir'], links: { '/work/alias': 'dir' } });
cases.push({ name: 'repeated hunk', cohort: 'original', args: [], atomic: true, input: repeated, directories: ['/work'], files: { '/work/first': 'keep\n', '/work/target': 'old\nmiddle\ntail\n' } });
cases.push({ ...cases[6], name: 'selected ancestor control', cohort: 'control-not-coverage', args: ['-p0'] });
cases.push({ ...cases[7], name: 'repeated hunk second matching line control', cohort: 'control-not-coverage', files: { '/work/first': 'keep\n', '/work/target': 'old\nold\ntail\n' } });
cases.push({ ...cases[7], name: 'incomplete repeated hunk control', cohort: 'control-not-coverage', input: repeated.replace('@@ -1 +1 @@\n-old\n+other\n', '@@ -1,2 +1 @@\n-old\n+other\n') });

async function virtualNamespace(filesystem) {
  const rows = {};
  async function walk(path) {
    const stat = await filesystem.lstat(path);
    rows[path] = { type: stat.type, mode: stat.mode, nlink: stat.nlink, ...(stat.type === 'file' ? { hex: Buffer.from(await filesystem.readFile(path)).toString('hex') } : stat.type === 'symlink' ? { link: await filesystem.readlink(path) } : {}) };
    if (stat.type === 'directory') for (const entry of (await filesystem.readdir(path)).sort((left, right) => left.name.localeCompare(right.name))) await walk(`${path === '/' ? '' : path}/${entry.name}`);
  }
  await walk('/');
  return rows;
}
async function nativeNamespace(root) {
  const rows = {};
  async function walk(path) {
    const actual = root + (path === '/' ? '' : path);
    const stat = await host.lstat(actual, { bigint: true });
    const type = stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file';
    rows[path] = { type, mode: Number(stat.mode & 0o7777n), nlink: Number(stat.nlink), device: stat.dev.toString(), inode: stat.ino.toString(), size: stat.size.toString(), ...(type === 'file' ? { hex: (await host.readFile(actual)).toString('hex') } : type === 'symlink' ? { link: await host.readlink(actual) } : {}) };
    if (type === 'directory') for (const name of (await host.readdir(actual)).sort()) await walk(`${path === '/' ? '' : path}/${name}`);
  }
  await walk('/');
  return rows;
}
const results = [];
for (const fixture of cases) {
  const filesystem = new MemoryFileSystem();
  for (const path of fixture.directories) await filesystem.mkdir(path, { recursive: true });
  for (const [path, bytes] of Object.entries(fixture.files)) await filesystem.writeFile(path, Buffer.from(bytes));
  for (const [path, target] of Object.entries(fixture.links ?? {})) await filesystem.symlink(target, path);
  const before = await virtualNamespace(filesystem);
  const shell = new Shell({ fs: filesystem, cwd: '/work', limits: { maxOutputBytes: 65536 } }).use(diffPatchCommands());
  const args = [...(fixture.atomic ? ['--atomic'] : []), ...fixture.args];
  const command = ['patch', ...args].map(value => `'${value.replaceAll("'", "'\\''")}'`).join(' ');
  const outcome = await shell.exec(command, { stdin: fixture.input });
  const virtual = { args, status: outcome.exitCode, stdout: outcome.stdout, stderr: outcome.stderr, stdoutHex: Buffer.from(outcome.stdout).toString('hex'), stderrHex: Buffer.from(outcome.stderr).toString('hex'), before, after: await virtualNamespace(filesystem) };
  const natives = [];
  for (const profile of profiles) {
    const root = await host.mkdtemp(resolve(base, '.scratch', 'native-'));
    try {
      for (const path of fixture.directories) await host.mkdir(root + path, { recursive: true });
      for (const [path, bytes] of Object.entries(fixture.files)) await host.writeFile(root + path, bytes);
      for (const [path, target] of Object.entries(fixture.links ?? {})) await host.symlink(target, root + path);
      const nativeBefore = await nativeNamespace(root);
      const nativeArgs = ['-f', ...(profile.profile === 'gnu' ? ['--no-backup-if-mismatch'] : []), ...fixture.args.map(value => value.startsWith('/') ? root + value : value)];
      const result = spawnSync(profile.path, nativeArgs, { cwd: `${root}/work`, input: fixture.input, timeout: 3000, maxBuffer: 65536, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: root, TMPDIR: root, PATCH_GET: '0' } });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      natives.push({ profile: profile.profile, args: nativeArgs, status: result.status, stdoutHex: result.stdout.toString('hex'), stderrHex: result.stderr.toString('hex'), stdout: result.stdout.toString(), stderr: result.stderr.toString(), before: nativeBefore, after: await nativeNamespace(root) });
    } finally { await host.rm(root, { recursive: true, force: true }); }
  }
  results.push({ fixture, inputSha256: hash(fixture.input), virtual, natives });
}
save(`${base}/${label}-native-product.json`, { capturedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, qualification: 'GNU 2.8 / Apple patch on Darwin, not GNU/Linux; --atomic has no native equivalent; controls excluded from eight-original coverage', profiles, results });
console.log(results.map(row => ({ name: row.fixture.name, virtual: row.virtual.status, natives: row.natives.map(native => [native.profile, native.status]), beforeRootLinks: row.virtual.before['/'].nlink, afterRootLinks: row.virtual.after['/'].nlink })));
