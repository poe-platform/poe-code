import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateGitHistoricalRecord(row, actual) {
  assert(actual, 'HISTORICAL_ENTRY_MISSING');
  assert(row.type === 'blob' && ['100644', '100755'].includes(row.mode), 'GIT_REGULAR_CLASS');
  assert.equal(actual.blob, row.blob, 'GIT_BLOB');
  assert.equal(Boolean(actual.mode & 73), row.mode === '100755', 'GIT_EXECUTABLE_CLASS');
}

export function validateHistoricalRecord(row, actual, expected) {
  assert(expected && Number.isSafeInteger(expected.mode) && expected.mode >= 0 && expected.mode <= 4095, 'MODE_AUTHORITY_MISSING');
  validateGitHistoricalRecord(row, actual);
  assert.equal(Boolean(expected.mode & 73), row.mode === '100755', 'AUTHORITY_GIT_CLASS');
  assert.equal(actual.mode, expected.mode, 'POSIX_MODE');
  assert.equal(actual.sha256, expected.sha256, 'SEALED_SHA256');
  assert.equal(actual.bytes, expected.bytes, 'SEALED_BYTES');
}

export function loadHistoricalAuthority(definition, readGit, gitBlob) {
  const read = reference => {
    const bytes = readGit(reference.revision, reference.path);
    assert.equal(hash(bytes), reference.sha256, 'AUTHORITY_RAW_SHA256');
    assert.equal(bytes.length, reference.bytes, 'AUTHORITY_BYTES');
    assert.equal(gitBlob(reference.revision, reference.path), reference.blob, 'AUTHORITY_GIT_BLOB');
    return JSON.parse(bytes);
  };
  const pointer = (value, path) => path.split('/').slice(1).reduce((current, key) => current[key], value);
  const seal = read(definition.seal);
  const files = {};
  const directories = {};
  if (seal.entries) {
    for (const entry of seal.entries) {
      const path = entry.path === '.' ? '' : entry.path;
      assert(!Object.hasOwn(files, path) && !Object.hasOwn(directories, path), 'AUTHORITY_DUPLICATE');
      if (entry.kind === 'file') files[path] = { mode: entry.mode, bytes: entry.bytes, sha256: entry.sha256 };
      else { assert.equal(entry.kind, 'directory'); directories[path] = entry.mode; }
    }
    if (seal.entryDigest) assert.equal(hash(JSON.stringify(seal.entries)), seal.entryDigest, 'ORIGINAL_ENTRY_DIGEST');
  } else {
    Object.assign(files, seal.files);
    directories[''] = seal.rootMode;
    assert(Object.keys(files).every(path => !path.includes('/')), 'FLAT_SEAL_DIRECTORY_AUTHORITY');
  }
  assert(!Object.hasOwn(files, 'FINAL-SEAL.json'), 'SELF_SEAL_DUPLICATE');
  let selfMode = null;
  if (definition.self.kind === 'entry') {
    const record = pointer(read(definition.self.reference), definition.self.reference.pointer);
    assert(record.path === 'FINAL-SEAL.json' || record.path === definition.scope + '/FINAL-SEAL.json', 'SELF_ENTRY_PATH');
    assert.equal(record.sha256, definition.seal.sha256, 'SELF_ENTRY_SHA256');
    assert.equal(record.bytes, definition.seal.bytes, 'SELF_ENTRY_BYTES');
    selfMode = record.mode;
  } else if (definition.self.kind === 'committed_complete_tree_digest') {
    const reference = definition.self.reference;
    const root = pointer(read(reference), reference.pointer);
    assert.equal(root.commit, definition.revision);
    assert.equal(root.path, definition.scope);
    assert.equal(root.sealSha256, definition.seal.sha256);
    const serializer = readGit(definition.self.serializer.revision, definition.self.serializer.path);
    assert.equal(hash(serializer), definition.self.serializer.sha256, 'SERIALIZER_RAW_SHA256');
    selfMode = definition.self.mode;
    const completeFiles = { ...files, 'FINAL-SEAL.json': { mode: selfMode, bytes: definition.seal.bytes, sha256: definition.seal.sha256 } };
    const entries = [];
    const walk = path => {
      entries.push({ path: path || '.', kind: 'directory', mode: directories[path] });
      const immediate = value => value.slice(0, value.lastIndexOf('/') < 0 ? 0 : value.lastIndexOf('/')) === path;
      for (const child of [...Object.keys(completeFiles), ...Object.keys(directories).filter(Boolean)].filter(immediate).sort()) {
        if (Object.hasOwn(directories, child)) walk(child);
        else { const value = completeFiles[child]; entries.push({ path: child, kind: 'file', mode: value.mode, bytes: value.bytes, sha256: value.sha256 }); }
      }
    };
    walk('');
    assert.equal(Object.keys(completeFiles).length, root.files, 'COMPLETE_TREE_COUNT');
    assert.equal(hash(JSON.stringify(entries)), root.liveTreeDigest, 'SELF_MODE_COMPLETE_TREE_AUTHORITY');
  } else assert.equal(definition.self.kind, 'MISSING_COMMITTED_POSIX_MODE_AUTHORITY');
  files['FINAL-SEAL.json'] = { mode: selfMode, bytes: definition.seal.bytes, sha256: definition.seal.sha256 };
  return { files, directories, selfModeAuthority: selfMode === null ? 'DENY_MISSING' : 'AUTHENTICATED_COMMITTED_METADATA', references: definition };
}

export function modeDataControls(compoundEntry, compoundBlob) {
  const row = { mode: '100644', type: 'blob', blob: compoundBlob };
  const actual = { ...compoundEntry, blob: compoundBlob };
  const results = [];
  validateHistoricalRecord(row, actual, compoundEntry);
  results.push({ id: 'sealed0600-git100644', expected: 'ACCEPT_DATA_IDENTITY', actual: 'ACCEPT_DATA_IDENTITY' });
  const reject = (id, execute, message) => { assert.throws(execute, error => error.message.includes(message)); results.push({ id, expected: message, actual: message }); };
  reject('wrong-full-mode', () => validateHistoricalRecord(row, { ...actual, mode: 420 }, compoundEntry), 'POSIX_MODE');
  reject('missing-mode-authority', () => validateHistoricalRecord(row, actual, { ...compoundEntry, mode: undefined }), 'MODE_AUTHORITY_MISSING');
  reject('missing-entry-authority', () => validateHistoricalRecord(row, actual, undefined), 'MODE_AUTHORITY_MISSING');
  reject('missing-actual-entry', () => validateHistoricalRecord(row, undefined, compoundEntry), 'HISTORICAL_ENTRY_MISSING');
  reject('wrong-content', () => validateHistoricalRecord(row, { ...actual, sha256: '0'.repeat(64) }, compoundEntry), 'SEALED_SHA256');
  reject('wrong-size', () => validateHistoricalRecord(row, { ...actual, bytes: actual.bytes + 1 }, compoundEntry), 'SEALED_BYTES');
  reject('wrong-git-blob', () => validateHistoricalRecord(row, { ...actual, blob: '0'.repeat(40) }, compoundEntry), 'GIT_BLOB');
  reject('wrong-git-type', () => validateHistoricalRecord({ ...row, type: 'tree' }, actual, compoundEntry), 'GIT_REGULAR_CLASS');
  reject('unexpected-executable', () => validateHistoricalRecord(row, { ...actual, mode: 457 }, compoundEntry), 'GIT_EXECUTABLE_CLASS');
  return results;
}
