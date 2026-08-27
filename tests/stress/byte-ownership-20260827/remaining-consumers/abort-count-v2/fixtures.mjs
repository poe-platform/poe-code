import assert from 'node:assert/strict';

export const hex = bytes => Buffer.from(bytes).toString('hex');

export function borrowed(kind, chunks, afterRead) {
  const width = Math.max(1, ...chunks.map(chunk => chunk.length / 2));
  const backing = kind === 'Buffer' ? Buffer.alloc(width + 14, 0x9d) : new Uint8Array(width + 14).fill(0x9d);
  const window = backing.subarray(7, 7 + width);
  assert.equal(window.byteOffset - backing.byteOffset, 7);
  const state = { yielded: 0, resumed: 0, finalized: false, unchangedChecks: 0 };
  const source = (async function* () {
    try {
      for (const encoded of chunks) {
        window.fill(0xa6);
        window.set(Buffer.from(encoded, 'hex'));
        const before = hex(backing);
        state.yielded++;
        try { yield window.subarray(0, encoded.length / 2); }
        finally {
          assert.equal(hex(backing), before, 'consumer mutated borrowed bytes before next read');
          state.unchangedChecks++;
        }
        state.resumed++;
        afterRead?.(state.resumed);
      }
    } finally {
      window.fill(0);
      assert.equal(hex(backing.subarray(0, 7)), '9d9d9d9d9d9d9d');
      assert.equal(hex(backing.subarray(7 + width)), '9d9d9d9d9d9d9d');
      state.finalized = true;
    }
  })();
  return { source, state };
}

export function complete(state, chunks) {
  assert.deepEqual(state, { yielded: chunks.length, resumed: chunks.length, finalized: true, unchangedChecks: chunks.length });
}

export function splitArchive(bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 73) chunks.push(hex(bytes.subarray(offset, offset + 73)));
  chunks.splice(1, 0, '');
  return chunks;
}
