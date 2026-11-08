import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { probeMp4 } from './mp4.js';
import { probeMp4MetadataSource } from './mp4-metadata-source.js';

const native = readFileSync(new URL('./fixtures/keyed.m4a', import.meta.url));
for (const mutation of ['none', 'empty', 'short entry', 'oversized entry', 'unknown namespace', 'invalid index'] as const) {
  it(`reads keyed metadata with ${mutation}`, async () => {
    const bytes = Buffer.from(native);
    const keys = bytes.indexOf('keys') + 4;
    if (mutation === 'empty') bytes.writeUInt32BE(0, keys + 4);
    if (mutation === 'short entry') bytes.writeUInt32BE(7, keys + 8);
    if (mutation === 'oversized entry') bytes.writeUInt32BE(0xffffffff, keys + 8);
    if (mutation === 'unknown namespace') bytes.write('test', keys + 12);
    if (mutation === 'invalid index') bytes.writeUInt32BE(0xffffffff, bytes.indexOf('ilst') + 8);
    const expected = mutation === 'none' ? 'abc123' : undefined;
    assert.equal(probeMp4(bytes).format.tags?.session_id, expected);
    const result = await probeMp4MetadataSource({ size: bytes.length,
      async read(offset, length) { return bytes.subarray(offset, offset + Math.min(length, 3)); }
    }, 0);
    const value = result.tags.session_id;
    let text = typeof value === 'string' ? value : undefined;
    if (typeof value === 'object') {
      text = '';
      for await (const chunk of value.chunks()) text += chunk;
    }
    assert.equal(text, expected);
  });
}
