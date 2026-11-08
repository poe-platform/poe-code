import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sniffMimeType, acceptsMimeType } from './index.js';
import { classify } from './classify.js';
test('shared MIME detection preserves signatures, classification and filename fallback', () => {
  assert.equal(sniffMimeType('wrong.txt', Uint8Array.of(137,80,78,71,13,10,26,10)), 'image/png');
  assert.equal(sniffMimeType('unknown', new TextEncoder().encode('{"value":1}')), 'application/json');
  assert.equal(sniffMimeType('/image.png/file.MP4', Uint8Array.of(0)), 'video/mp4');
  assert.equal(classify(new TextEncoder().encode('plain'), true).mime, 'text/plain');
  assert.equal(acceptsMimeType(['image/*'], 'image/png'), true);
  assert.equal(acceptsMimeType(['image/*'], 'image/png\n'), false);
});
