import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const own = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(own, '../../../..');
export const prefix = relative(repository, own);
export const oldLayer = dirname(own);
export const candidate = '57855a0293edb83bff98113123806497b4427416';
export const authorFreeze = '2d02ebe87bf7b18548190ba6a607649cef8d04e3';
export const independentFreeze = '589f90eae8dfa493558b5c62221590c86805f05a';
export const helperPath = 'src/shell/cancellation.ts';
export const expectedSource = '2685ad5723036ef217881e3c3b5f62882a2647e287f518d3cfd4f8416fc330a2';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const objectId = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
export const git = (...args) => execFileSync('git', args, { cwd: repository, maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
export const text = (...args) => git(...args).toString().trim();
export const sourceAt = (commit, path) => git('show', `${commit}:${path}`);
export const json = filename => JSON.parse(readFileSync(filename));
export function write(filename, bytes) {
  assert.equal(existsSync(filename), false, `no capture overwrite: ${filename}`);
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, bytes, { flag: 'wx' });
}
export function writeJson(filename, value) { write(filename, JSON.stringify(value, null, 2) + '\n'); }
export function inventory(directory, exclude) {
  const members = {};
  function visit(filename) {
    if (filename === exclude) return;
    const info = lstatSync(filename);
    assert.equal(info.isSymbolicLink(), false, `no symlink: ${filename}`);
    const name = relative(directory, filename) || '.';
    if (info.isDirectory()) {
      members[name] = { kind: 'directory', mode: info.mode & 0o777 };
      for (const entry of readdirSync(filename).sort()) visit(join(filename, entry));
    } else {
      assert.ok(info.isFile(), `regular file: ${filename}`);
      const bytes = readFileSync(filename);
      members[name] = { kind: 'file', size: bytes.length, mode: info.mode & 0o777, sha256: sha256(bytes) };
    }
  }
  visit(directory);
  return members;
}
export function treeEntries(bytes) {
  const rows = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    const space = bytes.indexOf(32, cursor);
    const zero = bytes.indexOf(0, space);
    assert.ok(space > cursor && zero > space);
    const mode = bytes.subarray(cursor, space).toString();
    rows.push({ mode, name: bytes.subarray(space + 1, zero).toString(), oid: bytes.subarray(zero + 1, zero + 21).toString('hex'), type: mode === '40000' ? 'tree' : mode === '160000' ? 'commit' : 'blob' });
    cursor = zero + 21;
  }
  assert.equal(cursor, bytes.length);
  return rows;
}
export function objectCollector() {
  const objects = new Map();
  const paths = [];
  function keep(type, identifier) {
    if (!objects.has(identifier)) {
      const bytes = git('cat-file', type, identifier);
      assert.equal(objectId(type, bytes), identifier);
      objects.set(identifier, { type, oid: identifier, size: bytes.length, sha256: sha256(bytes), base64: bytes.toString('base64') });
    }
    return Buffer.from(objects.get(identifier).base64, 'base64');
  }
  function bind(commit, path, contents = false, recurse = false) {
    let current = keep('commit', commit).toString().match(/^tree (.+)$/m)[1];
    let entry;
    for (const name of path.split('/')) {
      entry = treeEntries(keep('tree', current)).find(item => item.name === name);
      assert.ok(entry, `${commit}:${path}`);
      current = entry.oid;
    }
    if (contents || entry.type === 'tree') keep(entry.type, entry.oid);
    function visit(identifier) { for (const child of treeEntries(keep('tree', identifier))) if (child.type === 'tree') visit(child.oid); }
    if (recurse) visit(entry.oid);
    const binding = { commit, path, ...entry, ...(contents ? { sha256: sha256(keep(entry.type, entry.oid)) } : {}) };
    paths.push(binding);
    return binding;
  }
  return { keep, bind, snapshot: () => ({ objects: [...objects.values()], paths }) };
}
export function foreignIndex() {
  const attempts = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const head = text('rev-parse', 'HEAD');
    const entries = git('ls-files', '--stage', '-z').toString().split('\0').filter(Boolean).filter(row => !row.slice(row.indexOf('\t') + 1).startsWith(prefix + '/'));
    const staged = git('diff', '--cached', '--raw', '--no-abbrev', '-z', '--', '.', `:(exclude)${prefix}`);
    const afterHead = text('rev-parse', 'HEAD');
    attempts.push({ head, afterHead, indexSha256: sha256(entries.join('\0') + '\0') });
    if (head !== afterHead) continue;
    if (staged.length === 0) {
      const expected = git('ls-tree', '-r', '-z', head).toString().split('\0').filter(Boolean)
        .map(row => /^(\d+) (\w+) ([0-9a-f]{40})\t([\s\S]+)$/.exec(row))
        .filter(row => !row[4].startsWith(prefix + '/')).map(row => `${row[1]} ${row[3]} 0\t${row[4]}`);
      assert.deepEqual(entries, expected, 'index matches contemporaneous HEAD, including newline paths');
    }
    return { head, entries: entries.length, sha256: sha256(entries.join('\0') + '\0'), stagedBase64: staged.toString('base64'), checkedAgainstOwnHead: staged.length === 0, attempts };
  }
  throw new Error('HEAD moved during all bounded index snapshots');
}
export function liveState() {
  const files = {};
  for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', 'src/index.ts', 'src/plugins/index.ts']) if (existsSync(join(repository, path))) files[path] = sha256(readFileSync(join(repository, path)));
  return { index: foreignIndex(), files, shell: inventory(join(repository, 'src/shell')), contracts: inventory(join(repository, 'src/contracts')),
    oldLayer: inventory(oldLayer, own), originalStage1: inventory(join(repository, 'tests/shell/cancellation-stage1-independent-20260827')),
    authorHistory: inventory(join(repository, 'tests/shell/cancellation-stage1-20260827')) };
}
export function launch(evidence, scratch, name, executable, args, extraEnvironment = {}) {
  const environment = { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: join(scratch, 'tmp'), LANG: 'C', LC_ALL: 'C', TZ: 'UTC', NODE_NO_WARNINGS: '1', ...extraEnvironment };
  const started = new Date().toISOString();
  const result = spawnSync(executable, args, { cwd: scratch, env: environment, encoding: 'utf8', timeout: 45000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
  const record = { name, executable, executableSha256: sha256(readFileSync(executable)), args, cwd: scratch, environment, started, ended: new Date().toISOString(), pid: result.pid,
    exit: result.status, signal: result.signal, error: result.error ? { message: result.error.message, code: result.error.code } : null,
    stdoutSha256: sha256(result.stdout ?? ''), stderrSha256: sha256(result.stderr ?? '') };
  write(join(evidence, `${name}.stdout`), result.stdout ?? '');
  write(join(evidence, `${name}.stderr`), result.stderr ?? '');
  writeJson(join(evidence, `${name}-process.json`), record);
  assert.equal(result.error, undefined, `${name}: no infrastructure failure`);
  assert.equal(result.signal, null, `${name}: natural termination`);
  return { ...result, record };
}
