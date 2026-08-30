import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const repo = '/Users/kjopek/Workspace/safe-bash';
const root = '/tmp/safe-bash-adapter-corrections-0yDYsZ';
const pin = 'b2d202a7a2c8831df9c2d143bc43c74d1a099b14';
const phase = process.argv[2];
assert.ok(phase && /^[a-z0-9-]+$/.test(phase));
const directory = join(root, phase);
const archive = join(directory, 'archive');
assert.ok(!existsSync(directory));
mkdirSync(archive, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer: 128 * 1024 * 1024 });
const hash = data => createHash('sha256').update(data).digest('hex');
const save = (name, value) => writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + '\n');
const tar = git('archive', pin, 'src', 'tests/fs', 'tests/stress/adapters', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json');
const unpacked = spawnSync('tar', ['-xf', '-', '-C', archive], { input: tar });
assert.equal(unpacked.status, 0);
symlinkSync(join(root, 'node_modules'), join(archive, 'node_modules'));
const scopes = ['src/fs/s3', 'src/fs/webdav', 'tests/fs/s3', 'tests/fs/webdav', 'tests/stress/adapters'];
const owned = [...new Set([...git('ls-files', '--', ...scopes).toString().trim().split('\n'), ...git('ls-files', '--others', '--exclude-standard', '--', ...scopes).toString().trim().split('\n')])].filter(path => path && !path.includes('/evidence/'));
let patch = '*** Begin Patch\n';
let changes = 0;
if (!phase.startsWith('00-original')) for (const path of owned) {
  const current = readFileSync(join(repo, path), 'utf8');
  const present = existsSync(join(archive, path));
  const previous = present ? readFileSync(join(archive, path), 'utf8') : '';
  if (present && current === previous) continue;
  assert.ok(!current || current.endsWith('\n'));
  patch += `*** ${present ? 'Update' : 'Add'} File: ${join(archive, path)}\n`;
  if (present) {
    patch += '@@\n';
    if (previous) patch += previous.slice(0, -1).split('\n').map(line => '-' + line + '\n').join('');
  }
  if (current) patch += current.slice(0, -1).split('\n').map(line => '+' + line + '\n').join('');
  changes++;
}
patch += '*** End Patch\n';
if (changes) {
  const applied = spawnSync('apply_patch', { input: patch, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(applied.status, 0, applied.stderr);
}
const sourcePaths = git('ls-tree', '-r', '--name-only', pin, '--', 'src', 'tests/fs/conformance', 'package.json', 'package-lock.json').toString().trim().split('\n');
const paths = [...new Set([...sourcePaths, ...owned.filter(path => existsSync(join(archive, path)))])].filter(path => !path.includes('/evidence/')).sort();
const manifest = () => paths.map(path => ({ path, sha256: hash(readFileSync(join(archive, path))) }));
const before = manifest();
save('manifest-before.json', before);
save('provenance.json', { pin, phase, archive, archiveBaseSha256: hash(tar), sourceOverlayPaths: phase.startsWith('00-original') ? [] : owned.filter(path => {
  try { return hash(git('show', `${pin}:${path}`)) !== hash(readFileSync(join(archive, path))); } catch { return true; }
}), node: process.version, tooling: Object.fromEntries(['tsx', 'typescript', 'esbuild', '@types/node'].map(name => [name, JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'))).version])) });
const commands = JSON.parse(readFileSync(join(root, `${phase}.commands.json`), 'utf8'));
for (const command of commands) {
  const start = new Date().toISOString();
  const result = spawnSync(process.execPath, command.args, { cwd: archive, encoding: 'utf8', timeout: 90000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, TMPDIR: directory, TSX_DISABLE_CACHE: '1' } });
  writeFileSync(join(directory, command.name + '.stdout'), result.stdout ?? '');
  writeFileSync(join(directory, command.name + '.stderr'), result.stderr ?? '');
  save(command.name + '.exit.json', { argv: [process.execPath, ...command.args], cwd: archive, start, end: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message });
  console.log(phase, command.name, result.status);
}
assert.deepEqual(manifest(), before);
save('manifest-after.json', manifest());
save('stability.json', { files: paths.length, unchanged: true });
