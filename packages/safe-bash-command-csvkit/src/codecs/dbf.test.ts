import { test, expect } from 'vitest';
import { pythonCodecs, resolveCodec } from './python.js';
import tables from '../../../../docs/csvkit/dbf-codepage-reference.json' with { type: 'json' };
import { PythonException } from '../diagnostics/index.js';

test('DBF single-byte codepages match every frozen CPython decoder byte', async () => {
  const signal = new AbortController().signal;
  for (const [encoding, values] of Object.entries(tables)) {
    const { codec } = resolveCodec(pythonCodecs, encoding);
    for (const [byte, codepoint] of values.entries()) {
      if (codepoint < 0) await expect(codec.decode(Uint8Array.of(byte), encoding, signal)).rejects.toBeInstanceOf(PythonException);
      else expect(await codec.decode(Uint8Array.of(byte), encoding, signal)).toBe(String.fromCodePoint(codepoint));
    }
  }
});
