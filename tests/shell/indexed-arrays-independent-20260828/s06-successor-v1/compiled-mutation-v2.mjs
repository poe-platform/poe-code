import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function data(value, keys) {
  assert.ok(value !== null && typeof value === 'object');
  assert.deepEqual(Reflect.ownKeys(value).sort(), [...keys].sort());
  for (const key of keys) assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}
export function prepareCompiledMutation(original, specification) {
  data(specification, ['id','member','originalSha256','originalBytes','mode','replacements','prefix','finalLF','changedSha256','changedBytes']);
  const members = { U01: 'dist/shell/arrays/ledger.js', U02: 'dist/shell/arrays/bindings.js', U04: 'dist/shell/arrays/bindings.js', U12: 'dist/shell/arrays/ledger.js' };
  assert.equal(typeof specification.id, 'string'); assert.ok(Object.hasOwn(members, specification.id));
  assert.equal(specification.member, members[specification.id]); assert.equal(specification.mode, 0o644);
  for (const key of ['originalSha256','changedSha256']) { assert.equal(typeof specification[key], 'string'); assert.match(specification[key], /^[a-f0-9]{64}$/u); }
  for (const key of ['originalBytes','changedBytes']) assert.ok(Number.isSafeInteger(specification[key]) && specification[key] > 0 && specification[key] <= 1024 * 1024);
  assert.ok(Buffer.isBuffer(original));
  assert.equal(original.length, specification.originalBytes);
  assert.equal(digest(original), specification.originalSha256);
  assert.equal(specification.finalLF, true);
  assert.notEqual(original.at(-1), 10, 'this exact compiled input has no final LF');
  assert.equal(typeof specification.prefix, 'string'); assert.ok(specification.prefix.length <= 4096);
  assert.ok(Array.isArray(specification.replacements));
  assert.ok(specification.replacements.length > 0 && specification.replacements.length <= 2);
  data(specification.replacements, [...Array(specification.replacements.length).keys()].map(String).concat('length'));
  let text = original.toString('utf8');
  assert.equal(Buffer.from(text).compare(original), 0);
  for (const replacement of specification.replacements) {
    data(replacement, ['before','after']);
    assert.equal(typeof replacement.before, 'string'); assert.ok(replacement.before.length > 0 && replacement.before.length <= 4096);
    assert.equal(typeof replacement.after, 'string'); assert.ok(replacement.after.length <= 4096);
    assert.equal(text.split(replacement.before).length, 2, 'exactly one declared mutation site');
    text = text.replace(replacement.before, () => replacement.after);
  }
  const declared = Buffer.from(specification.prefix + text + '\n');
  assert.equal(declared.length, specification.changedBytes);
  assert.equal(digest(declared), specification.changedSha256);
  return declared;
}
export function compiledMutationPatch(filename, original, declared) {
  assert.equal(typeof filename, 'string'); assert.ok(filename.startsWith('/') && !filename.includes('\n'));
  assert.ok(Buffer.isBuffer(original) && Buffer.isBuffer(declared));
  assert.notEqual(original.at(-1), 10); assert.equal(declared.at(-1), 10);
  const before = original.toString('utf8'), after = declared.toString('utf8');
  assert.equal(Buffer.from(before).compare(original), 0); assert.equal(Buffer.from(after).compare(declared), 0);
  return `*** Begin Patch\n*** Update File: ${filename}\n@@\n${before.split('\n').map(line => '-' + line).join('\n')}\n${after.slice(0, -1).split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`;
}
