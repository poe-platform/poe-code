import assert from 'node:assert/strict';
import { lstat, mkdtemp, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { oracleIdentity } from '../../gnu-target/oracle.ts';
import { golden } from '../../fuzz/helpers.ts';
import { memory, run } from '../../editflows/helpers.ts';
import { replacement } from '../../editflows/fixtures.ts';
import { execute, observe, setup, snapshot, target } from '../../emptyfile-delta/helpers.ts';
import { decoys, vectors } from '../../emptyfile-delta/vectors.ts';
import { command, directory, hash, save, sourceState } from './capture.mjs';

const beforeSource = sourceState();
const pins = { gnu: oracleIdentity('patch'), apple: oracleIdentity('patch', 'apple-calibration') };
async function namespace(root) {
  const entries = {};
  async function visit(path, relative) {
    const stat = await lstat(path);
    const type = stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file';
    const children = type === 'directory' ? (await readdir(path)).sort() : undefined;
    entries[relative] = { type, mode: stat.mode, nlink: stat.nlink, ino: stat.ino, dev: stat.dev, size: stat.size,
      ...(children ? { children, empty: children.length === 0 } : type === 'file'
        ? { base64: (await readFile(path)).toString('base64') } : { link: await readlink(path) }) };
    for (const name of children ?? []) await visit(join(path, name), `${relative === '/' ? '' : relative}/${name}`);
  }
  await visit(root, '/');
  return entries;
}
async function native(profile, files, links, args, input, absolute = false) {
  const root = await mkdtemp(join(process.cwd(), directory, '.author-native-'));
  try {
    await mkdir(join(root, 'work'));
    await mkdir(join(root, 'authorized'));
    for (const [path, bytes] of Object.entries(files)) {
      await mkdir(join(root, path, '..'), { recursive: true });
      await writeFile(join(root, path), bytes, { flag: 'wx' });
    }
    for (const [path, destination] of Object.entries(links)) await symlink(destination, join(root, path));
    const before = await namespace(root);
    const mapped = args.map(arg => absolute && arg === '/authorized/target' ? join(root, 'authorized/target') : arg);
    const result = command(pins[profile].path, [profile === 'gnu' ? '--batch' : '-f', ...mapped], {
      cwd: join(root, 'work'), input, timeout: 3000, maxBuffer: 65_536,
      env: { PATH: '/usr/bin:/bin', HOME: root, TMPDIR: root, LC_ALL: 'C', LANG: 'C', TZ: 'UTC', PATCH_GET: '0' },
    });
    return { root, cwd: join(root, 'work'), input, before, result, after: await namespace(root) };
  } finally { await rm(root, { recursive: true, force: true }); }
}
const repeated = '@@ -1 +1 @@\n-old\n+new\n@@ -1 +1 @@\n-old\n+other\n';
const prefix = golden('keep\n', 'changed\n', 'first') + '--- target\n+++ target\n';
const hunks = [];
for (const [name, body, initial] of [
  ['original-repeated-hunk', repeated, 'old\nmiddle\ntail\n'],
  ['repeated-hunk-relocated-match', repeated, 'old\nmiddle\nold\n'],
  ['truncated-body-utility-error', '@@ -1,2 +1 @@\n-old\n+new\n', 'old\nmiddle\ntail\n'],
]) {
  const input = prefix + body;
  const files = { first: 'keep\n', target: initial };
  const virtual = [];
  for (const args of [[], ['--atomic']]) {
    const filesystem = await memory(files);
    const before = await snapshot(filesystem);
    const result = await run('patch', args, filesystem, input);
    virtual.push({ args, before, result, after: await snapshot(filesystem) });
  }
  const natives = {};
  for (const profile of Object.keys(pins)) natives[profile] = await native(profile,
    Object.fromEntries(Object.entries(files).map(([path, bytes]) => [`work/${path}`, bytes])), {}, [], input);
  hunks.push({ name, input, virtual, natives });
}
const empty = [];
for (const vector of vectors.filter(vector => vector.status === 0 && vector.expected === null && !vector.args.includes('--dry-run') && target(vector) === '/authorized/target')) {
  const filesystem = await setup(vector);
  const before = await snapshot(filesystem);
  const observed = observe(filesystem);
  const result = await execute(observed.fs, vector.args, vector.input);
  const files = { 'authorized/target': vector.initial,
    ...Object.fromEntries(Object.entries(decoys).map(([path, bytes]) => [`work/${path}`, bytes])) };
  const natives = {};
  for (const profile of Object.keys(pins)) natives[profile] = await native(profile, files, {}, vector.args, vector.input, true);
  empty.push({ vector, virtual: { before, result, after: await snapshot(filesystem), calls: observed.calls,
    mutations: observed.mutations.map(({ method, path }) => ({ method, path })) }, natives });
}
const quoted = [];
for (const [name, header, args] of [
  ['stripped-ancestor-original', '"alias/target"', []],
  ['selected-ancestor-p0', '"alias/target"', ['-p0']],
  ['selected-final-symlink', '"alias"', []],
]) {
  const files = { first: 'old\n', target: 'old\n', 'dir/target': 'old\n' };
  const destination = name === 'selected-final-symlink' ? 'target' : 'dir';
  const input = replacement('first') + replacement(header);
  const filesystem = await memory(files);
  await filesystem.symlink(destination, '/work/alias');
  const before = await snapshot(filesystem);
  const result = await run('patch', args, filesystem, input);
  const natives = {};
  for (const profile of Object.keys(pins)) natives[profile] = await native(profile,
    Object.fromEntries(Object.entries(files).map(([path, bytes]) => [`work/${path}`, bytes])), { 'work/alias': destination }, args, input);
  quoted.push({ name, header, args, input, virtual: { before, result, after: await snapshot(filesystem) }, natives });
}
const sourceFiles = ['/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch.c',
  '/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/pch.c', '/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/util.c',
  '/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/patch.man'];
const localSources = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, hash(await readFile(path))])));
const output = process.argv[2] ?? 'native-controls-original.json';
save(`${directory}/${output}`, { capturedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  beforeSource, pins, localSources, hunks, empty, quoted, afterSource: sourceState(),
  limits: 'Pinned local executables only. Apple is separate calibration, not GNU/Linux evidence. Native --batch/-f avoids prompts; virtual defaults to batch. --atomic is virtual-only. Native absolute explicit target maps into isolated root; raw argv/output preserve that mapping. Snapshots include all entries, file bytes, links, nlink, empty directories; timestamp comparison is not claimed. Runtime fixture writes/cleanup only inside newly allocated author directories. No external user data or network writes.' });
assert.equal(empty.length, 6);
console.log(JSON.stringify({ hunks: hunks.map(row => ({ name: row.name, virtual: row.virtual.map(item => item.result.status), gnu: row.natives.gnu.result.status, apple: row.natives.apple.result.status })),
  empty: empty.map(row => ({ name: row.vector.name, gnu: row.natives.gnu.result.status, apple: row.natives.apple.result.status, nativeRootLinks: [row.natives.gnu.before['/'].nlink, row.natives.gnu.after['/'].nlink], virtualCalls: row.virtual.calls.filter(name => ['rm', 'rmdir'].includes(name)) })),
  quoted: quoted.map(row => ({ name: row.name, virtual: row.virtual.result.status, gnu: row.natives.gnu.result.status, apple: row.natives.apple.result.status })) }, null, 2));
