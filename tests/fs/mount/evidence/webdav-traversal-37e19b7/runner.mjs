import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const repo = '/Users/kjopek/Workspace/safe-bash';
const pin = process.env.SOURCE_REVISION ?? '21a6b9149e3a0e35e14f1c740860971f08053686';
const phase = process.argv[2];
assert.match(phase, /^[a-z0-9-]+$/);
const output = join(root, phase), archive = join(output, 'archive');
assert.ok(!existsSync(output));
mkdirSync(archive, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer: 128 * 1024 * 1024 });
const hash = data => createHash('sha256').update(data).digest('hex');
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n');
const tar = git('archive', pin, 'src', 'tests/fs', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json');
assert.equal(spawnSync('tar', ['-xf', '-', '-C', archive], { input: tar }).status, 0);
symlinkSync(join(repo, 'node_modules'), join(archive, 'node_modules'));
const changed = ['src/fs/mount/index.ts', 'src/fs/mount/README.md', 'tests/fs/mount/webdav-traversal.test.ts'];
let patch = '*** Begin Patch\n';
if (phase !== 'baseline') for (const path of changed) {
  const current = readFileSync(join(repo, path), 'utf8');
  const original = existsSync(join(archive, path)) ? readFileSync(join(archive, path), 'utf8') : undefined;
  if (original === current) continue;
  patch += `*** ${original === undefined ? 'Add' : 'Update'} File: ${path}\n`;
  if (original !== undefined) patch += '@@\n' + original.slice(0, -1).split('\n').map(line => '-' + line + '\n').join('');
  patch += current.slice(0, -1).split('\n').map(line => '+' + line + '\n').join('');
}
patch += '*** End Patch\n';
writeFileSync(join(output, 'candidate.patch'), patch);
if (phase !== 'baseline') {
  const applied = spawnSync('apply_patch', { cwd: archive, input: patch, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(applied.status, 0, applied.stderr);
}
const files = [...new Set([...git('ls-tree', '-r', '--name-only', pin, '--', 'src', 'tests/fs', 'package.json', 'package-lock.json', 'tsconfig.json').toString().trim().split('\n'), ...changed.filter(path => existsSync(join(archive, path)))])]
  .filter(path => !path.includes('/evidence/')).sort();
const manifest = () => files.map(path => ({ path, sha256: hash(readFileSync(join(archive, path))) }));
const before = manifest();
save('manifest-before.json', before);
save('provenance.json', { pin, phase, archiveSha256: hash(tar), worktreeHead: git('rev-parse', 'HEAD').toString().trim(), worktreeStatus: git('status', '--short').toString(), node: process.version, testFixture: before.find(entry => entry.path === 'tests/fs/mount/identity-compatibility-review/compatibility.test.ts'), originalReviewCommit: 'd799cbb', sourceAncestor: '4fa4ba9502dac843bd13aa5031d128a3171f597d' });
for (const command of JSON.parse(readFileSync(join(root, phase + '.commands.json'), 'utf8'))) {
  const start = new Date().toISOString();
  const result = spawnSync(process.execPath, command.args, { cwd: archive, encoding: 'utf8', timeout: 120000, maxBuffer: 24 * 1024 * 1024, env: { ...process.env, TMPDIR: output, TSX_DISABLE_CACHE: '1' } });
  writeFileSync(join(output, command.name + '.stdout'), result.stdout ?? '');
  writeFileSync(join(output, command.name + '.stderr'), result.stderr ?? '');
  save(command.name + '.exit.json', { argv: [process.execPath, ...command.args], cwd: archive, start, end: new Date().toISOString(), status: result.status, signal: result.signal, error: result.error?.message });
  console.log(command.name, result.status);
}
assert.deepEqual(manifest(), before);
save('manifest-after.json', manifest());
save('stability.json', { unchanged: true, files: files.length });
