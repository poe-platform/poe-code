import { expect, it } from 'vitest';
import { resource } from './resources.js';
it.each([
  { value: 'https://localhost/single-use?sig=%2f+synthetic' },
  { value: [104, 116, 116, 112, 58] },
  { value: { length: 5, 0: 104, 1: 116, 2: 116, 3: 112, 4: 58 } },
])('rejects non-byte resource operands instead of coercing their identity: $value', ({ value }) => {
  expect(() => resource(0, value as unknown as Uint8Array, 'input', 'read', 'input'))
    .toThrow('Resource classification requires original bytes');
});
it.each(['file:clip%2F.wav', 'file:clip*.wav', 'file:clip.wav'])('preserves the file protocol classification for %s', name => {
  expect(resource(0, new TextEncoder().encode(name), 'input', 'read', 'input').kind).toBe('file-protocol');
});
it.each([['1:local', 'url'], ['FILE:local', 'url'], ['PIPE:0', 'url'], ['subfile,,start,0,end,100,,:http://host/a', 'url']])('classifies %s consistently', (name, kind) => {
  expect(resource(0, new TextEncoder().encode(name), 'input', 'read', 'input').kind).toBe(kind);
});
it.each(['preset'] as const)('classifies the %s filename reader as a literal path', role => {
  for (const name of ['pipe:0', 'fd:3', 'https:local', 'frame%03d', '-', '']) {
    expect(resource(0, new TextEncoder().encode(name), role, 'read', 'input')).toMatchObject({ kind: 'path', literal: true });
  }
});
it('preserves AVIO semantics for slash-loaded option values', () => {
  expect(resource(0, new TextEncoder().encode('pipe:0'), 'option-file', 'read', 'input')).toMatchObject({ kind: 'descriptor' });
  expect(resource(0, new TextEncoder().encode('https://host/filter'), 'option-file', 'read', 'input')).toMatchObject({ kind: 'url' });
});
