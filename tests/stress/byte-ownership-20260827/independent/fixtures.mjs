import assert from 'node:assert/strict';

export const hex = bytes => Buffer.from(bytes).toString('hex');
export const watchdog = { timeout: 15000 };

export function borrowed(kind, chunks, options = {}) {
  const backing = kind === 'Buffer' ? Buffer.alloc(29, 0x9d) : new Uint8Array(29).fill(0x9d);
  const window = backing.subarray(7, 23);
  const state = { resumed: 0, finalized: false, noMutationChecks: 0 };
  assert.equal(window.byteOffset - backing.byteOffset, 7);
  const source = (async function* () {
    try {
      for (const encoded of chunks) {
        window.fill(0xa6);
        window.set(Buffer.from(encoded, 'hex'));
        const before = hex(backing);
        try { yield window.subarray(0, encoded.length / 2); }
        finally {
          assert.equal(hex(backing), before, 'consumer must not mutate borrowed storage');
          state.noMutationChecks++;
        }
        state.resumed++;
        options.afterRead?.(state.resumed);
      }
    } finally {
      window.fill(0);
      assert.equal(hex(backing.subarray(0, 7)), '9d9d9d9d9d9d9d');
      assert.equal(hex(backing.subarray(23)), '9d9d9d9d9d9d');
      state.finalized = true;
    }
  })();
  return { source, state };
}

export function completed(state, count) {
  assert.deepEqual(state, { resumed: count, finalized: true, noMutationChecks: count });
}

export function success(result, expected) {
  assert.deepEqual({ stdout: hex(result.stdoutBytes), stderr: hex(result.stderrBytes), status: result.exitCode },
    { stdout: expected, stderr: '', status: 0 });
}
