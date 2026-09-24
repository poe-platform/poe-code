import assert from 'node:assert/strict';
import test from 'node:test';
import { diff3DefaultLimits, parseDiff3Arguments } from './behavior.js';
import { analyzeDiff3 } from './engine.js';

test('omitted diff3 behavior quotas are unlimited and explicit quotas remain independent', () => {
  for (const limit of Object.values(diff3DefaultLimits)) assert.equal(limit, Infinity);
  const path = 'a'.repeat(65537);
  assert.deepEqual(parseDiff3Arguments([path, 'b', 'c']).files, [path, 'b', 'c']);
  assert.throws(() => parseDiff3Arguments([path, 'b', 'c'], { ...diff3DefaultLimits, argumentBytes: 65536 }), /limit/i);
  assert.deepEqual(parseDiff3Arguments([path, 'b', 'c'], { ...diff3DefaultLimits, outputBytes: 0 }).files, [path, 'b', 'c']);
});

test('pure diff3 accepts omitted and individually configured limits', () => {
  const files = { base: new Uint8Array([97, 10]), left: new Uint8Array([97, 10]), right: new Uint8Array([97, 10]) };
  assert.equal(analyzeDiff3(files, {}).regions.length, 0);
  assert.throws(() => analyzeDiff3(files, { inputBytes: 1 }), /inputBytes limit exceeded/);
  assert.equal(analyzeDiff3(files, { inputBytes: 6 }).regions.length, 0);
});
