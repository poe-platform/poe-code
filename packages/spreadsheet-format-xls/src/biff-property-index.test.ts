import { expect, it } from 'vitest';
import { BiffPropertyDescriptorIndex } from './biff-property-index.js';
function storage() {
  const data = new Uint8Array(4e6); let end = 8, transfers = 0;
  return { allocate(size: number) { const at = end; end += size; return at; }, async write(at: number, bytes: Uint8Array) {
    expect(bytes.length).toBeLessThanOrEqual(16384); data.set(bytes, at); transfers++;
  }, async read(at: number, size: number) { expect(size).toBeLessThanOrEqual(16384); transfers++; return data.subarray(at, at + size); },
    async close() {}, get transfers() { return transfers; } };
}
it('validates unordered ranges and replays descriptor order beyond the fixed cache', async () => {
  const store = storage(), index = new BiffPropertyDescriptorIndex(store, () => {}), expected = [];
  for (let i = 0; i < 300; i++) { const entry = { name: `Name${i}`, offset: (300 - i) * 10, size: 3, block: i }; expected.push(entry); await index.add(entry); }
  await index.validate(); const result = []; for await (const entry of index.entries()) result.push(entry);
  expect(result).toEqual(expected); expect(store.transfers).toBeGreaterThan(300);
});
it('rejects case-folded duplicate names including expanding Unicode case mappings', async () => {
  const index = new BiffPropertyDescriptorIndex(storage(), () => {});
  await index.add({ name: 'Straße', offset: 8, size: 0, block: 0 });
  await expect(index.add({ name: 'STRASSE', offset: 8, size: 0, block: 0 })).rejects.toThrow('duplicate');
});
it.each([false, true])('preserves stable ordering of zero-length ranges at equal offsets (overlap=%s)', async overlap => {
  const index = new BiffPropertyDescriptorIndex(storage(), () => {});
  await index.add({ name: 'A', offset: 8, size: overlap ? 2 : 0, block: 0 });
  await index.add({ name: 'B', offset: 8, size: overlap ? 0 : 2, block: 0 });
  if (overlap) await expect(index.validate()).rejects.toThrow('overlapping'); else await index.validate();
});
