import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as host from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Shell } from '../../../../../src/shell/index.ts';
import { MemoryFileSystem } from '../../../../../src/fs/memory/index.ts';
import { diffPatchCommands } from '../../../../../src/commands/diff-patch/index.ts';
import { oracleIdentity } from '../../gnu-target/oracle.ts';
import { repeatedMatchFixtures } from '../../fuzz/repeated-match-fixtures.ts';

export const directory = 'tests/commands/diff-patch-stress/evidence/fullgate-51282a9-followup';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { maxBuffer: 32 * 1024 * 1024, timeout: 300_000, ...options });
  return { executable, args, status: result.status, signal: result.signal, error: result.error?.message,
    stdout: result.stdout?.toString(), stderr: result.stderr?.toString(),
    stdoutHex: result.stdout?.toString('hex'), stderrHex: result.stderr?.toString('hex') };
}
export function save(path, value) {
  assert.throws(() => readFileSync(path), { code: 'ENOENT' });
  const text = JSON.stringify(value, null, 2) + '\n';
  const patch = `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { input: patch, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
}
export function sourceState() {
  const paths = readdirSync('src/commands/diff-patch').sort().map(name => `src/commands/diff-patch/${name}`);
  const files = Object.fromEntries(paths.map(path => [path, { sha256: hash(readFileSync(path)), text: readFileSync(path, 'utf8') }]));
  return { capturedAt: new Date().toISOString(), head: command('git', ['rev-parse', 'HEAD']).stdout.trim(),
    status: command('git', ['status', '--short']).stdout, index: command('git', ['diff', '--cached', '--raw']).stdout,
    aggregate: hash(JSON.stringify(Object.fromEntries(Object.entries(files).map(([path, row]) => [path, row.sha256])))), files };
}
export async function virtualNamespace(filesystem) {
  const rows = {};
  async function walk(path) {
    const stat = await filesystem.lstat(path);
    rows[path] = { type: stat.type, mode: stat.mode, nlink: stat.nlink,
      ...(stat.type === 'file' ? { hex: Buffer.from(await filesystem.readFile(path)).toString('hex') } : {}) };
    if (stat.type === 'directory') for (const entry of (await filesystem.readdir(path)).sort((left, right) => left.name.localeCompare(right.name))) await walk(`${path === '/' ? '' : path}/${entry.name}`);
  }
  await walk('/');
  return rows;
}
export async function virtualRun(fixture, atomic) {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir('/work');
  await filesystem.writeFile('/work/first', Buffer.from('keep\n'));
  await filesystem.writeFile('/work/target', Buffer.from(fixture.target));
  const before = await virtualNamespace(filesystem);
  const shell = new Shell({ fs: filesystem, cwd: '/work', limits: { maxOutputBytes: 65536 } }).use(diffPatchCommands());
  const result = await shell.exec(atomic ? 'patch --atomic' : 'patch', { stdin: fixture.input });
  return { atomic, status: result.exitCode, stdout: result.stdout, stderr: result.stderr,
    stdoutHex: Buffer.from(result.stdout).toString('hex'), stderrHex: Buffer.from(result.stderr).toString('hex'),
    before, after: await virtualNamespace(filesystem) };
}
async function nativeNamespace(root) {
  const rows = {};
  async function walk(path) {
    const actual = root + (path === '/' ? '' : path);
    const stat = await host.lstat(actual, { bigint: true });
    const type = stat.isDirectory() ? 'directory' : 'file';
    rows[path] = { type, mode: Number(stat.mode & 0o7777n), nlink: Number(stat.nlink), device: stat.dev.toString(), inode: stat.ino.toString(), size: stat.size.toString(),
      ...(type === 'file' ? { hex: (await host.readFile(actual)).toString('hex') } : {}) };
    if (type === 'directory') for (const name of (await host.readdir(actual)).sort()) await walk(`${path === '/' ? '' : path}/${name}`);
  }
  await walk('/');
  return rows;
}
async function capture(phase) {
  const before = sourceState();
  const pins = ['gnu', 'apple-calibration'].flatMap(profile => ['diff', 'patch'].map(tool => ({ profile, tool, ...oracleIdentity(tool, profile) })));
  const nativeSource = '/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch.c';
  const nativeSourceBytes = readFileSync(nativeSource);
  const rows = [];
  for (const fixture of repeatedMatchFixtures) {
    const virtual = [];
    for (const atomic of [false, true]) virtual.push(await virtualRun(fixture, atomic));
    const natives = [];
    for (const pin of pins.filter(pin => pin.tool === 'patch')) {
      const root = await host.mkdtemp(resolve(directory, '.native-followup-'));
      await host.mkdir(`${root}/work`);
      await host.writeFile(`${root}/work/first`, 'keep\n');
      await host.writeFile(`${root}/work/target`, fixture.target);
      const nativeBefore = await nativeNamespace(root);
      const result = command(pin.path, ['-f'], { cwd: `${root}/work`, input: fixture.input,
        env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C', TZ: 'UTC', HOME: root, TMPDIR: root, PATCH_GET: '0' } });
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      natives.push({ profile: pin.profile, ...result, before: nativeBefore, after: await nativeNamespace(root) });
      await host.rm(root, { recursive: true });
    }
    rows.push({ fixture, inputSha256: hash(fixture.input), virtual, natives });
  }
  save(`${directory}/${phase}.json`, { before, pins, nativeSource: { path: nativeSource, sha256: hash(nativeSourceBytes), locateHunk: nativeSourceBytes.toString().split('\n').slice(1150, 1237).join('\n') },
    qualification: 'Pinned GNU patch 2.8 / diff 3.12 on Darwin, not GNU/Linux. Apple is separate calibration. Atomic has no native equivalent.', rows, after: sourceState() });
  console.log(rows.map(row => ({ name: row.fixture.name, virtual: row.virtual.map(result => result.status), native: row.natives.map(result => [result.profile, result.status]) })));
}
if (process.argv[1] === resolve(directory, 'capture.mjs')) await capture(process.argv[2]);
