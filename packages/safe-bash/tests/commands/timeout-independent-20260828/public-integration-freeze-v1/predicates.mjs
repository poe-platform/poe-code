import assert from 'node:assert/strict';
import { baseline, acceptedModule, expected78, factories, publicPaths } from './cases.mjs';

export function assertInventory(names) {
  assert.equal(names.length, 78, 'DEFAULT_COUNT');
  assert.equal(new Set(names).size, 78, 'DUPLICATE_DEFAULT');
  assert.deepEqual([...names].sort(), expected78, 'DEFAULT_NAMES');
}

export function assertSafeInput(row) {
  assert.equal(typeof row.path, 'string', 'INPUT_PATH');
  const parts = row.path.split('/');
  assert.ok(parts.every(part => part && part !== '.' && part !== '..'), 'INPUT_PATH');
  assert.ok(!row.path.includes('\\') && !row.path.includes('\0'), 'INPUT_PATH');
  assert.ok(!parts.some(part => part.toLowerCase() === 'agents.md'), 'AGENTS_INPUT');
  assert.ok(row.mode === '100644' || row.mode === '100755', 'INPUT_MODE');
  assert.match(row.blob, /^[a-f0-9]{40}$/, 'INPUT_BLOB');
  assert.match(row.sha256, /^[a-f0-9]{64}$/, 'INPUT_HASH');
  assert.ok(Number.isSafeInteger(row.bytes) && row.bytes >= 0, 'INPUT_BYTES');
}

export function assertComposition(actual, acceptedInputs, declared) {
  assert.equal(declared.baseline, baseline, 'WRONG_BASELINE');
  assert.equal(declared.module, acceptedModule, 'WRONG_MODULE');
  assert.match(declared.candidate, /^[a-f0-9]{40}$/, 'CANDIDATE_REQUIRED');
  assert.deepEqual(declared.public.map(row => row.path).sort(), [...publicPaths].sort(), 'PUBLIC_PATHS');
  assert.equal(new Set(actual.map(row => row.path)).size, actual.length, 'DUPLICATE_INPUT');
  assert.deepEqual(actual.map(row => row.path).sort(), acceptedInputs.map(row => row.path).sort(), 'UNLISTED_OR_MISSING_INPUT');
  for (const row of [...actual, ...declared.public]) assertSafeInput(row);
  for (const row of declared.public) {
    assert.equal(row.commit, declared.candidate, 'PUBLIC_COMMIT');
    assert.equal(row.mode, acceptedInputs.find(input => input.path === row.path).mode, 'PUBLIC_MODE');
  }
  const expected = new Map(acceptedInputs.map(row => [row.path, row]));
  for (const row of declared.public) expected.set(row.path, row);
  for (const row of actual) {
    const wanted = expected.get(row.path);
    for (const key of ['mode', 'blob', 'sha256', 'bytes']) assert.equal(row[key], wanted[key], `INPUT_${key.toUpperCase()}:${row.path}`);
  }
}

export function assertExports(actual, original) {
  const expected = structuredClone(original);
  expected.exports['./commands/timeout'] = {
    types: './dist/commands/timeout/index.d.ts', import: './dist/commands/timeout/index.js',
  };
  assert.deepEqual(actual, expected, 'PACKAGE_EXPORT_DELTA');
}

export function assertSurface(root, leaf) {
  assert.deepEqual(Object.keys(leaf).sort(), [...factories].sort(), 'LEAF_EXPORTS');
  for (const name of factories) {
    assert.equal(typeof root[name], 'function', `MISSING_ROOT_EXPORT:${name}`);
    assert.equal(root[name], leaf[name], `ROOT_LEAF_IDENTITY:${name}`);
  }
}

export function assertTypeOutcome(receipt, expected) {
  const required = expected.entrypoint === 'root' ? 'dist/index.d.ts' : 'dist/commands/timeout/index.d.ts';
  assert.ok(receipt.authenticatedReads.includes(required), 'DECLARATION_ENTRYPOINT');
  assert.equal(receipt.sourceFallback, false, 'TYPE_SOURCE_FALLBACK');
  assert.equal(receipt.unboundReads, 0, 'UNBOUND_DECLARATION');
  if (expected.expected === 'accept') {
    assert.equal(receipt.exitCode, 0, 'TYPE_EXIT');
    assert.deepEqual(receipt.diagnostics, [], 'UNEXPECTED_TYPE_DIAGNOSTIC');
  } else {
    assert.equal(receipt.exitCode, 2, 'TYPE_EXIT');
    assert.equal(receipt.diagnostics.length, 1, 'TYPE_DIAGNOSTIC_COUNT');
    const diagnostic = receipt.diagnostics[0];
    assert.equal(diagnostic.file, 'consumer.ts', 'TYPE_DIAGNOSTIC_FILE');
    assert.equal(diagnostic.code, expected.code, 'TYPE_DIAGNOSTIC_CODE');
    assert.equal(diagnostic.line, expected.line, 'TYPE_DIAGNOSTIC_LINE');
    assert.equal(diagnostic.token, expected.property, 'TYPE_DIAGNOSTIC_TOKEN');
    assert.ok(typeof diagnostic.message === 'string' && diagnostic.message.length > 0, 'TYPE_DIAGNOSTIC_MESSAGE_REQUIRED');
    for (const term of expected.messageTerms) assert.ok(diagnostic.message.includes(term), 'TYPE_DIAGNOSTIC_MEANING');
  }
}
