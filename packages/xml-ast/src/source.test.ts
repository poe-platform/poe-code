import { expect, it, vi } from 'vitest';
import { XmlSource } from './source.js';
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

for (const body of [
  'x😀'.repeat(4000),
  ('a&amp;&#x1f600;&lt;&gt;&quot;&apos;').repeat(400),
  '&#' + '0'.repeat(10000) + '65;',
]) it(`fragments a logical text node with bounded entity decoding (${body.length})`, () => {
  const source = `<r>${body}</r>`;
  let actual = '', fragments = 0;
  const parser = parseXmlSourceSteps(undefined, {
    retainTree: false, fragmentContent: true, maxContentNodes: 2,
    events(event) {
      if (event.type !== 'content') return;
      expect(event.content.kind).toBe('text');
      expect(event.content.text.length).toBeLessThanOrEqual(512);
      expect(event.continuation === true).toBe(fragments > 0);
      actual += event.content.text;
      fragments++;
    },
  });
  let step = parser.next();
  while (!step.done) {
    if (typeof step.value !== 'number') {
      if (!('offset' in step.value)) throw new Error('unexpected frame request');
      step.value.value = source.slice(step.value.offset, step.value.offset + Math.min(7, step.value.length));
      step.value.complete = step.value.offset + step.value.value.length === source.length;
    }
    step = parser.next();
  }
  expect(actual).toBe(parseXml(source).text);
  expect(fragments).toBeGreaterThan(0);
});

it('does not materialize a large entity token on the fragmented source path', () => {
  const source = '<r>&#' + '0'.repeat(20000) + '65;</r>';
  const slice = vi.spyOn(XmlSource.prototype, 'slice');
  try {
    const parser = parseXmlSourceSteps(source.length, { retainTree: false, fragmentContent: true });
    let step = parser.next();
    while (!step.done) {
      if (typeof step.value !== 'number') {
        if (!('offset' in step.value)) throw new Error('unexpected frame request');
        step.value.value = source.slice(step.value.offset, step.value.offset + step.value.length);
      }
      step = parser.next();
    }
    expect(slice.mock.calls.every(([start, end]) => end !== undefined && end - start <= 512)).toBe(true);
  } finally { slice.mockRestore(); }
});

for (const recover of [false, true]) for (const body of [
  'a&missing;b', 'a&unterminated', '&#x;', '&#;', '&#xyz;', '&#0;', '&#x110000;',
  'a'.repeat(511) + ']]>', 'a&bad;]]>', 'a&amp;lt;b', '&missing;',
]) it(`fragmented text preserves diagnostics and recovery (${recover}, ${body.slice(-25)})`, () => {
  const input = `<r>${body}</r>`;
  const messages: string[] = [], expectedMessages: string[] = [];
  let expected: string | undefined, actual = '', expectedError: unknown, actualError: unknown;
  try { expected = parseXml(input, recover ? { recover: message => { expectedMessages.push(message); } } : {}).text; }
  catch (error) { expectedError = error; }
  const parser = parseXmlSourceSteps(input.length, {
    retainTree: false, fragmentContent: true,
    ...(recover ? { recover: (message: string) => { messages.push(message); } } : {}),
    events(event) { if (event.type === 'content') actual += event.content.text; },
  });
  try {
    let step = parser.next();
    while (!step.done) {
      if (typeof step.value !== 'number') {
        if (!('offset' in step.value)) throw new Error('unexpected frame request');
        step.value.value = input.slice(step.value.offset, step.value.offset + step.value.length);
      }
      step = parser.next();
    }
  } catch (error) { actualError = error; }
  expect(actualError).toEqual(expectedError);
  expect(messages).toEqual(expectedMessages);
  if (!expectedError) expect(actual).toBe(expected);
});

it('bounded delimiter searches do not pull input past the logical text span', () => {
  const source = new XmlSource(undefined);
  const search = source.indexOf(';', 0, 5);
  const step = search.next();
  if (typeof step.value !== 'object') throw new Error('expected source read');
  step.value.value = 'a&bad';
  expect(search.next()).toEqual({ done: true, value: -1 });
});

it('text fragmentation preserves text-limit precedence and publishes no partial invalid node', () => {
  for (const body of ['a'.repeat(1024), 'a'.repeat(1024) + '&bad;']) {
    const input = `<r>${body}</r>`;
    let expected: unknown, actual: unknown, events = 0;
    try { parseXml(input, { maxTextLength: 1, maxContentNodes: 1 }); } catch (error) { expected = error; }
    const parser = parseXmlSourceSteps(input.length, {
      retainTree: false, fragmentContent: true, maxTextLength: 1, maxContentNodes: 1,
      events(event) { if (event.type === 'content') events++; },
    });
    try {
      let step = parser.next();
      while (!step.done) {
        if (typeof step.value !== 'number') {
          if (!('offset' in step.value)) throw new Error('unexpected frame request');
          step.value.value = input.slice(step.value.offset, step.value.offset + step.value.length);
        }
        step = parser.next();
      }
    } catch (error) { actual = error; }
    expect(actual).toEqual(expected);
    expect(events).toBe(0);
  }
});

for (const kind of ['comment', 'processing-instruction'] as const) for (const body of ['', 'x😀&'.repeat(3000)])
it(`fragments ${kind} bodies without adding nodes (${body.length})`, () => {
  const input = kind === 'comment' ? `<r><!--${body}--></r>` : `<r><?target ${body}?></r>`;
  let actual = '', events = 0;
  const parser = parseXmlSourceSteps(input.length, {
    retainTree: false, fragmentContent: true, maxContentNodes: 2,
    events(event) {
      if (event.type !== 'content') return;
      expect(event.content.kind).toBe(kind);
      expect(event.content.text.length).toBeLessThanOrEqual(512);
      expect(event.continuation === true).toBe(events > 0);
      actual += event.content.text;
      events++;
    },
  });
  let step = parser.next();
  while (!step.done) {
    if (typeof step.value !== 'number') {
      if (!('offset' in step.value)) throw new Error('unexpected frame request');
      step.value.value = input.slice(step.value.offset, step.value.offset + step.value.length);
    }
    step = parser.next();
  }
  expect(actual).toBe(body);
  expect(events).toBeGreaterThan(0);
});

for (const input of [
  '<r><!--' + 'a'.repeat(511) + '--b--></r>',
  '<r><!--' + 'a'.repeat(511) + '---></r>',
  '<r><!--unterminated</r>', '<r><?target=bad?></r>', '<r><?target missing</r>',
]) it(`fragmented raw content preserves rejection before events (${input.slice(-30)})`, () => {
  let expected: unknown, actual: unknown, events = 0;
  try { parseXml(input); } catch (error) { expected = error; }
  const parser = parseXmlSourceSteps(input.length, {
    retainTree: false, fragmentContent: true,
    events(event) { if (event.type === 'content') events++; },
  });
  try {
    let step = parser.next();
    while (!step.done) {
      if (typeof step.value !== 'number') {
        if (!('offset' in step.value)) throw new Error('unexpected frame request');
        step.value.value = input.slice(step.value.offset, step.value.offset + step.value.length);
      }
      step = parser.next();
    }
  } catch (error) { actual = error; }
  expect(expected).toBeInstanceOf(SyntaxError);
  expect(actual).toEqual(expected);
  expect(events).toBe(0);
});

it('keeps declaration validation and metadata bounded when requested', () => {
  const gap = ' '.repeat(20000);
  const input = `<?xml${gap}version${gap}=${gap}'1.0'${gap}encoding='UTF-8'${gap}standalone='yes'${gap}?><r/>`;
  const slices = vi.spyOn(XmlSource.prototype, 'slice');
  try {
    const parser = parseXmlSourceSteps(input.length, { compactDeclaration: true });
    let step = parser.next();
    while (!step.done) {
      if (typeof step.value !== 'number') {
        if (!('offset' in step.value)) throw new Error('unexpected frame request');
        step.value.value = input.slice(step.value.offset, step.value.offset + step.value.length);
      }
      step = parser.next();
    }
    expect(step.value.declaration?.length).toBeLessThan(100);
    expect(step.value.declaration).toBe('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    expect(slices.mock.calls.every(([start, end]) => end !== undefined && end - start <= 512)).toBe(true);
  } finally { slices.mockRestore(); }
  expect(parseXml(input).declaration).toBe(input.slice(0, input.indexOf('?>') + 2));
});

for (const field of ["version", "encoding", "standalone"]) it(`rejects oversized declaration ${field} without copying it`, () => {
  const prefix = field === 'version' ? '' : "version='1.0' ";
  const input = `<?xml ${prefix}${field}='${'x'.repeat(10000)}'?><r/>`;
  const slices = vi.spyOn(XmlSource.prototype, 'slice');
  try {
    const parser = parseXmlSourceSteps(input.length, { compactDeclaration: true });
    expect(() => {
      let step = parser.next();
      while (!step.done) {
        if (typeof step.value !== 'number') {
          if (!('offset' in step.value)) throw new Error('unexpected frame request');
          step.value.value = input.slice(step.value.offset, step.value.offset + step.value.length);
        }
        step = parser.next();
      }
    }).toThrow('unsupported XML declaration');
    expect(slices.mock.calls.every(([start, end]) => end !== undefined && end - start <= 512)).toBe(true);
  } finally { slices.mockRestore(); }
});

it('requires host completion of namespace operations', () => {
  const parser = parseXmlSourceSteps(4, { retainTree: false, storeNamespaces: true });
  const step = parser.next();
  expect(step.done).toBe(false);
  expect(step.value).toMatchObject({ namespaceOperation: 'set', prefix: 'xml' });
  expect(() => parser.next()).toThrow('Incomplete XML namespace update');
});

it('requires nonretained parsing for external namespace scopes', () => {
  const parser = parseXmlSourceSteps(4, { storeNamespaces: true });
  expect(() => parser.next()).toThrow('Stored XML namespaces require retainTree: false');
});

it('requires host completion of attribute appends', () => {
  const input = '<r a="1"/>';
  const parser = parseXmlSourceSteps(input.length, { retainTree: false, storeAttributes: true });
  let step = parser.next();
  while (!step.done) {
    if (typeof step.value !== 'number') {
      if ('attributeOperation' in step.value) {
        expect(step.value.attributeOperation).toBe('append');
        expect(() => parser.next()).toThrow('Incomplete XML attribute append');
        return;
      }
      if (!('offset' in step.value)) throw new Error('unexpected request');
      step.value.value = input.slice(step.value.offset, step.value.offset + step.value.length);
    }
    step = parser.next();
  }
  throw new Error('expected an attribute append request');
});

it('requires nonretained parsing for external attribute collections', () => {
  const parser = parseXmlSourceSteps(4, { storeAttributes: true });
  expect(() => parser.next()).toThrow('Stored XML attributes require retainTree: false');
});

it('requires host attribute storage for value fragments', () => {
  const parser = parseXmlSourceSteps(4, { retainTree: false, fragmentAttributes: true });
  expect(() => parser.next()).toThrow('XML attribute fragments require storeAttributes: true');
});
