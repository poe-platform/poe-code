import type { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource } from './contracts.js';
import { OfficeError } from './errors.js';
import { partName } from './package-uri.js';
import type { XmlRange } from './retained-xml.js';
import { RetainedValues, characters, equal, literal } from './retained-values.js';
function unsafe(): never { throw new OfficeError('unsafe-path', 'Invalid package part name.', 'index'); }
const unreserved = (code: number) => code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122 || '-._~'.includes(String.fromCharCode(code));

async function* normalizeSegment(source: ByteSource): ByteSource {
  const encoder = new TextEncoder(); let buffer = '', escape = '', last = '', length = 0;
  for await (const character of characters(source)) {
    const code = character.codePointAt(0)!; length++; last = character;
    if (escape) {
      if (!'0123456789abcdefABCDEF'.includes(character)) unsafe(); escape += character;
      if (escape.length === 3) {
        const byte = Number.parseInt(escape.slice(1), 16);
        if (byte < 32 || byte >= 127 || byte === 47 || byte === 92 || unreserved(byte)) unsafe();
        buffer += escape.toUpperCase(); escape = '';
      }
    } else if (character === '%') escape = '%';
    else {
      const international = code >= 0xa0 && code <= 0xd7ff || code >= 0xf900 && code <= 0xfdcf || code >= 0xfdf0 && code <= 0xffef
        || code >= 0x10000 && code <= 0xefffd && (code & 0xffff) <= 0xfffd && (code < 0xe0000 || code >= 0xe1000);
      if (!(code < 128 ? unreserved(code) || "!$&'()*+,;=:@".includes(character) : international)) unsafe();
      buffer += character;
    }
    if (buffer.length >= 2048) { yield encoder.encode(buffer); buffer = ''; }
  }
  if (!length || last === '.' || escape) unsafe();
  if (buffer) yield encoder.encode(buffer);
}

/** Resolves OPC targets without accumulating a path or segment stack. All
 * transient segments and links share the graph's caller-backed page cache.
 * Callers serialize writes to this storage; returned ranges remain replayable. */
export async function resolveRetainedPartReference(baseURI: string, reference: ByteSource, pages: PagedStorage, values: RetainedValues): Promise<XmlRange> {
  const base = baseURI === '/' ? '' : partName(baseURI, false).slice(1);
  let top = 0;
  async function row(pointer: number) {
    const bytes = await pages.read(pointer, 40), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length: 5 }, (_, n) => view.getFloat64(n * 8, true));
  }
  async function push(segment: XmlRange) {
    const special = await equal(values.read(segment), literal('[Content_Types].xml'));
    const normalized = special ? segment : await values.store(normalizeSegment(values.read(segment)));
    const bytes = new Uint8Array(40), view = new DataView(bytes.buffer), pointer = pages.allocate(40);
    [top, 0, normalized.start, normalized.length, Number(special)].forEach((value, n) => view.setFloat64(n * 8, value, true));
    await pages.write(pointer, bytes); top = pointer;
  }
  const input = characters(reference); let current: string | undefined, failed = false;
  const next = async () => { const result = await input.next(); current = result.done ? undefined : result.value; };
  try {
    await next(); if (current === undefined) unsafe();
    const absolute = current === '/';
    if (absolute) await next();
    else if (base) for (const segment of base.split('/')) await push(await values.store(literal(segment)));
    let first = true;
    for (;;) {
      const segment = await values.store((async function* () {
        const encoder = new TextEncoder(); let buffer = '';
        while (current !== undefined && current !== '/') {
          buffer += current; await next();
          if (buffer.length >= 2048) { yield encoder.encode(buffer); buffer = ''; }
        }
        if (buffer) yield encoder.encode(buffer);
      })());
      if (!segment.length) unsafe();
      if (first && !absolute) for await (const bytes of values.read(segment)) if (bytes.includes(58)) unsafe();
      first = false;
      if (await equal(values.read(segment), literal('.'))) { if (current === undefined) unsafe(); }
      else if (await equal(values.read(segment), literal('..'))) {
        if (!top || current === undefined) unsafe(); top = (await row(top))[0]!;
      } else await push(segment);
      if (current === undefined) break;
      await next();
    }
    let head = 0, depth = 0, special = false;
    for (let pointer = top; pointer;) {
      const data = await row(pointer), link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, head, true);
      await pages.write(pointer + 8, link); head = pointer; pointer = data[0]!; depth++; special ||= Boolean(data[4]);
    }
    if (!head || special && depth !== 1) unsafe();
    return await values.store((async function* () {
      for (let pointer = head; pointer;) {
        const data = await row(pointer); yield* literal('/'); yield* values.read({ start: data[2]!, length: data[3]! }); pointer = data[1]!;
      }
    })());
  } catch (error) { failed = true; throw error; }
  finally { try { await input.return(undefined); } catch (error) { if (!failed) await Promise.reject(error); } }
}
