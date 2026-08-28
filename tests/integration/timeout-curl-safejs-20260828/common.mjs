import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const own = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(own, '../../..');
export const node = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
export const git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
export const privateRoot = '/Users/kjopek/Workspace/poe-code';
export const candidate = '67eab12e315054907ef4ef435c6bbca2f59e0c36';
export const engineCommit = 'bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e';
export const packHash = '6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const hashFile = filename => sha(fs.readFileSync(filename));
export const read = filename => JSON.parse(fs.readFileSync(filename));
export const reason = error => ({ name: error?.name, code: error?.code, message: String(error?.message ?? error), stack: error?.stack });
export function safe(name) {
  assert.ok(typeof name === 'string' && name && !name.startsWith('/') && !/[\\\0]/u.test(name) && !name.split('/').some(part => ['', '.', '..', 'AGENTS.md'].includes(part)), `UNSAFE_PATH:${name}`);
  return name;
}
export function write(filename, bytes, mode = 420) {
  fs.mkdirSync(dirname(filename), { recursive: true });
  fs.writeFileSync(filename, bytes, { flag: 'wx', mode });
  fs.chmodSync(filename, mode);
}
export const save = (filename, value) => write(filename, JSON.stringify(value, null, 2) + '\n');
export const gitReceipts = [];
let gitDeadline = Infinity;
export const setGitDeadline = value => { gitDeadline = value; };
export function gitRead(root, args) {
  assert.ok(gitReceipts.length < 1200 && Date.now() < gitDeadline, 'GIT_CHILD_BOUND');
  const argv = ['--no-replace-objects', '-C', root, ...args];
  const child = spawnSync(git, argv, { env: { PATH: '/usr/bin:/bin', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }, maxBuffer: 4 * 1024 ** 2, timeout: Math.min(5000, gitDeadline - Date.now()) });
  let absent; try { process.kill(child.pid, 0); } catch (error) { absent = error.code === 'ESRCH'; }
  gitReceipts.push({ argv, pid: child.pid, status: child.status, signal: child.signal, error: child.error ? reason(child.error) : undefined, stdoutBytes: child.stdout?.length, stdoutSHA256: sha(child.stdout ?? ''), stderrBase64: child.stderr?.toString('base64'), reaped: absent === true });
  assert.equal(child.error, undefined, 'GIT_EXECUTION'); assert.equal(child.status, 0); assert.equal(child.signal, null); assert.equal(absent, true, 'GIT_REAPED');
  return child.stdout;
}
export function inventory(root, metadata = false, excluded = new Set()) {
  const rows = [];
  function visit(prefix) {
    for (const name of fs.readdirSync(join(root, prefix)).sort()) {
      if (excluded.has(name)) continue;
      const path = safe(prefix ? `${prefix}/${name}` : name), target = join(root, path), stat = fs.lstatSync(target);
      assert.ok(!stat.isSymbolicLink(), `SYMLINK:${path}`);
      if (stat.isDirectory()) { rows.push({ path, kind: 'directory', mode: stat.mode & 511 }); visit(path); }
      else { assert.ok(stat.isFile()); rows.push({ path, kind: 'file', mode: stat.mode & 511, bytes: stat.size, sha256: hashFile(target), ...(metadata ? { mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs } : {}) }); }
    }
  }
  visit(''); return rows;
}
export function privateState() {
  const query = args => gitRead(privateRoot, args).toString();
  const index = resolve(privateRoot, query(['rev-parse', '--git-path', 'index']).trim());
  return {
    head: query(['rev-parse', 'HEAD']).trim(), status: query(['status', '--porcelain=v1']), staged: query(['diff', '--cached', '--name-status']), indexSHA256: hashFile(index),
    engine: inventory(join(privateRoot, 'packages/safejs'), true, new Set(['.git', 'node_modules', 'dist', '.cache', '.turbo'])),
    metadata: Object.fromEntries(['package.json', 'package-lock.json', 'tsconfig.json', 'packages/poe-agent/package.json'].map(path => [path, hashFile(join(privateRoot, path))])),
  };
}
export function authenticate(row, base = repo) {
  const filename = row.absolute ? row.path : join(base, safe(row.path));
  const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink(), `REGULAR:${row.path}`);
  assert.equal(hashFile(filename), row.sha256, `HASH:${row.path}`);
  if (row.bytes !== undefined) assert.equal(stat.size, row.bytes);
  if (row.mode !== undefined) assert.equal(stat.mode & 511, row.mode);
  return fs.readFileSync(filename);
}
export const relativeOwn = filename => relative(own, filename);
