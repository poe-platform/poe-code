import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const repository = '/Users/kjopek/Workspace/safe-bash';
export const owned = 'tests/integration/du-public-independent-evidence-20260827';
export const recipeRoot = join(repository, owned, 'admission-v2');
export const runRoot = join(repository, owned, 'run-v2');
export const nodeBinary = '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node';
export const gitBinary = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
export const preparationCommit = 'ebd77c05134bc77311609e02cf4a35c8aff0fcc2';
export const originalSix = ['ADMISSION-ADDENDUM.v1.md', 'MANIFEST.json', 'README.md', 'controls.v1.json', 'preparation.v1.json', 'wrapper.v1.mjs'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
export const json = filename => JSON.parse(readFileSync(filename, 'utf8'));
export const maxFileBytes = 160 * 1024 * 1024;
let gitSupervisor;
export function superviseGit(callback) { gitSupervisor = callback; }

export function regular(filename, maximum = maxFileBytes) {
  const stat = lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `regular file required: ${filename}`);
  assert.ok(stat.size <= maximum, `file byte bound: ${filename}`);
  const bytes = readFileSync(filename);
  assert.equal(bytes.length, stat.size, filename);
  return bytes;
}

export function safeRelative(filename) {
  assert.equal(typeof filename, 'string');
  assert.ok(filename.length > 0 && !filename.startsWith('/') && !filename.includes('\\') && !filename.includes('\0'));
  assert.ok(!filename.split('/').some(part => ['', '.', '..', 'AGENTS.md'].includes(part)), filename);
  return filename;
}

export function git(...args) {
  gitSupervisor?.('before', args);
  const started = Date.now();
  try {
  const bytes = execFileSync(gitBinary, ['--no-optional-locks', ...args], {
    cwd: repository, timeout: 15000, maxBuffer: 32 * 1024 * 1024,
    env: { PATH: '/usr/bin:/bin', HOME: runRoot, TMPDIR: runRoot, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  });
  gitSupervisor?.('closed', args, { status: 0, bytes: bytes.length, elapsedMs: Date.now() - started });
  return bytes;
  } catch (error) {
    gitSupervisor?.('closed', args, { status: error.status, signal: error.signal, error: error.message, elapsedMs: Date.now() - started });
    throw error;
  }
}

export function entries(commit, selectors) {
  return git('ls-tree', '-r', '-z', commit, '--', ...selectors).toString().split('\0').filter(Boolean).map(line => {
    const [metadata, filename] = line.split('\t');
    const [mode, type, blob] = metadata.split(' ');
    safeRelative(filename);
    return { path: filename, mode, type, gitBlob: blob };
  });
}

export function census(root, allowLinks = false) {
  const records = [];
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      assert.notEqual(name, 'AGENTS.md', 'never copy or read agent files in a census');
      const filename = join(directory, name);
      const stat = lstatSync(filename);
      const record = { path: relative(root, filename), mode: stat.mode & 0o777 };
      if (stat.isSymbolicLink()) {
        assert.ok(allowLinks, `symlink rejected: ${filename}`);
        const target = realpathSync(filename);
        assert.ok(target.startsWith(`${resolve(root)}/`), 'tool alias escapes closure');
        records.push({ ...record, type: 'symlink', link: readlinkSync(filename), realpath: target, targetSha256: sha256(regular(target)) });
      } else if (stat.isDirectory()) {
        records.push({ ...record, type: 'directory' });
        visit(filename);
      } else {
        assert.ok(stat.isFile(), `nonregular input: ${filename}`);
        records.push({ ...record, type: 'file', bytes: stat.size, sha256: sha256(regular(filename)) });
      }
      assert.ok(records.length <= 12000, 'tree entry limit');
    }
  }
  assert.ok(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink());
  visit(root);
  return records.sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

export function authenticateReference(identity) {
  const selected = entries(identity.commit, [identity.path]);
  assert.deepEqual(selected, [{ path: identity.path, mode: identity.mode, type: 'blob', gitBlob: identity.gitBlob }]);
  const bytes = git('cat-file', 'blob', identity.gitBlob);
  assert.equal(gitBlob(bytes), identity.gitBlob);
  assert.equal(sha256(bytes), identity.sha256);
  return bytes;
}

export function inventoryGuard(actual, expected, readBlob) {
  const seen = new Set();
  assert.equal(actual.length, expected.length, 'complete input count');
  for (let index = 0; index < actual.length; index++) {
    const entry = actual[index];
    safeRelative(entry.path);
    assert.ok(!seen.has(entry.path), 'duplicate input');
    seen.add(entry.path);
    assert.equal(entry.mode, '100644', 'input mode');
    assert.equal(entry.type, 'blob', 'input type');
    assert.deepEqual(entry, expected[index], `exact input identity ${entry.path}`);
    if (readBlob) {
      const bytes = readBlob(entry);
      assert.equal(gitBlob(bytes), entry.gitBlob, 'input blob bytes');
      assert.equal(sha256(bytes), entry.sha256, 'input sha256 bytes');
    }
  }
}

export function modeGuard(value) {
  assert.equal(value.mode, 'scoped-committed-archive');
  assert.equal(value.fullHistoryArchiveProof, false);
  assert.equal(value.oldValidatorDispatched, false);
  assert.equal(value.transientRelabel, false);
}

export function bindingKeysGuard(value, keys) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'exact original binding keys');
  for (const key of keys) assert.ok(value[key] !== null && value[key] !== undefined, `UNBOUND ${key}`);
}

export function identityGuard(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
}

export function isolationGuard(actual) {
  assert.equal(actual, `${runRoot}/node_modules/work`, 'explicit owned write isolation');
}

export function publicHold() {
  return { admitted: false, status: 'HELD', reason: 'No authenticated accepted HTML74 or separately bound public executor/authorization', duCasesExecuted: 0 };
}

export function exactNames(actual, comparator) {
  assert.equal(actual.length, 75);
  assert.equal(new Set(actual).size, 75);
  assert.deepEqual([...actual].sort(), [...comparator].sort());
  for (const name of ['du', 'html-to-markdown']) assert.ok(actual.includes(name));
  for (const name of ['getopts', 'curl', 'safejs', 'expr']) assert.ok(!actual.includes(name));
}

export function publicGuard(vector) {
  assert.equal(vector.rootExport, true, 'root export');
  assert.equal(vector.subpathExport, true, 'subpath export');
  assert.equal(vector.sourceFallback, false, 'source fallback');
  assert.equal(vector.loadProofPresent, true, 'actual load proof absent');
  assert.equal(vector.loadProofAuthenticated, true, 'actual load proof tampered');
  assert.equal(vector.consumerMatched, true, 'consumer identity');
  assert.equal(vector.helperMatched, true, 'helper identity');
  assert.equal(vector.symlinkInstall, false, 'symlink install');
  assert.equal(vector.oldMoveLocationExists, false, 'old move location');
  return publicHold();
}
