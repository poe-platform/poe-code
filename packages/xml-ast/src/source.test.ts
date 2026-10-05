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

it('streaming reads stop on a node limit before requesting the next input chunk', () => {
  const parser = parseXmlSourceSteps(undefined, { maxNodes: 1 });
  const first = parser.next();
  expect(first.done).toBe(false);
  if (typeof first.value !== 'object' || !('offset' in first.value)) throw new Error('expected source read');
  expect(first.value.offset).toBe(0);
  first.value.value = '<r><x/>';
  expect(() => {
    for (const step of parser) if (typeof step !== 'number') throw new Error('unexpected next input read');
  }).toThrow('XML resource limit exceeded');
});

for (const width of [1, 7, 512]) it(`streams unknown-length source without overreading chunk boundaries (${width})`, () => {
  const source = '<r><x a="value">text</x><!--comment--><![CDATA[tail]]></r>';
  const parser = parseXmlSourceSteps(undefined);
  let step = parser.next();
  while (!step.done) {
    if (typeof step.value !== 'number') {
      const request = step.value;
      request.value = source.slice(request.offset, request.offset + Math.min(width, request.length));
      request.complete = request.offset + request.value.length === source.length;
    }
    step = parser.next();
  }
  expect(step.value).toEqual(parseXml(source));
});

for (const payload of ['', '😀'.repeat(5000)]) it(`fragments CDATA without changing logical content counts (${payload.length})`, () => {
  const source = `<r><![CDATA[${payload}]]></r>`;
  let actual = '', events = 0;
  const parser = parseXmlSourceSteps(source.length, {
    retainTree: false, fragmentContent: true, maxContentNodes: 2,
    events(event) {
      if (event.type !== 'content') return;
      expect(event.content.kind).toBe('cdata');
      expect(event.content.text.length).toBeLessThanOrEqual(512);
      expect(event.continuation === true).toBe(events > 0);
      expect(Array.from(event.content.text).every(character => character === '😀')).toBe(true);
      actual += event.content.text;
      events++;
    },
  });
  let step = parser.next();
  while (!step.done) {
    if (typeof step.value !== 'number') {
      if (!('offset' in step.value)) throw new Error('unexpected frame request');
      step.value.value = source.slice(step.value.offset, step.value.offset + step.value.length);
    }
    step = parser.next();
  }
  expect(actual).toBe(payload);
  expect(events).toBeGreaterThan(0);
});
