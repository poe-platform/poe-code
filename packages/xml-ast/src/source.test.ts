import { expect, it } from 'vitest';
import { normalizeXmlChunks, parseXml, parseXmlSourceSteps } from './index.js';

for (const width of [1, 511, 4096]) it(`external XML source preserves tokens across read windows (width=${width})`, () => {
  const source = '<r>' + ' '.repeat(width) + '<!--' + 'x'.repeat(8200) + '--><a p="' + 'z'.repeat(8200) + '">text</a></r>';
  const parser = parseXmlSourceSteps(source.length);
  let step = parser.next(), reads = 0;
  while (!step.done) {
    if (typeof step.value !== 'number') {
      expect(step.value.length).toBeLessThanOrEqual(4096);
      step.value.value = source.slice(step.value.offset, step.value.offset + step.value.length);
      reads++;
    }
    step = parser.next();
  }
  expect(reads).toBeGreaterThan(1);
  expect(step.value).toEqual(parseXml(source));
});

it('rejects incomplete external source reads', () => {
  const parser = parseXmlSourceSteps(10);
  while (true) {
    const step = parser.next();
    if (step.done) throw new Error('missing read');
    if (typeof step.value !== 'number') break;
  }
  expect(() => parser.next()).toThrow('Incomplete XML source read');
});

for (const width of [1, 2, 511, 512]) it(`normalizes borrowed chunks in bounded windows (width=${width})`, async () => {
  const source = '\uFEFF<r>' + 'a\r\n😀\ré\n'.repeat(1024) + '</r>';
  async function* chunks() {
    for (let index = 0; index < source.length; index += width) yield source.slice(index, index + width);
  }
  let normalized = '';
  for await (const chunk of normalizeXmlChunks(chunks())) {
    expect(chunk.length).toBeLessThanOrEqual(513);
    normalized += chunk;
  }
  expect(parseXml(normalized)).toEqual(parseXml(source));
});
