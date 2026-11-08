import type { PagedStorage } from '@poe-code/safe-fs/storage';
import type { ByteSource } from './contracts.js';
import { OfficeError } from './errors.js';
import { RetainedValues } from './retained-values.js';
import type { XmlRange } from './retained-xml.js';

// UTF-16BE preserves JavaScript's string ordering, including supplementary
// characters before high BMP characters. Original scalars never enter the heap.
async function* sortKey(source: ByteSource): ByteSource {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  function* encode(text: string) {
    for (let offset = 0; offset < text.length; offset += 8192) {
      const end = Math.min(offset + 8192, text.length), bytes = new Uint8Array((end - offset) * 2);
      for (let n = offset; n < end; n++) { const code = text.charCodeAt(n); bytes[(n - offset) * 2] = code >>> 8; bytes[(n - offset) * 2 + 1] = code & 255; }
      yield bytes;
    }
  }
  for await (const bytes of source) for (let offset = 0; offset < bytes.length; offset += 8192) yield* encode(decoder.decode(bytes.subarray(offset, offset + 8192), { stream: true }));
  yield* encode(decoder.decode());
}

/** Stable bottom-up linked-list merge sort. Rows, sort keys and merge links share
 * the caller's page cache; merge state is constant size and never recursive.
 * Writers must be serialized; entries are available only after seal completes. */
export class RetainedOrder {
  private head = 0;
  private tail = 0;
  private state: 'open' | 'sorting' | 'ready' | 'failed' = 'open';
  constructor(private readonly pages: PagedStorage, private readonly values: RetainedValues, private readonly check: () => void) {}
  private async row(pointer: number) {
    this.check(); const bytes = await this.pages.read(pointer, 40), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length: 5 }, (_, n) => view.getFloat64(n * 8, true));
  }
  private async write(pointer: number, data: number[]) {
    this.check(); const bytes = new Uint8Array(data.length * 8), view = new DataView(bytes.buffer);
    data.forEach((value, n) => view.setFloat64(n * 8, value, true)); await this.pages.write(pointer, bytes);
  }
  async add(key: ByteSource, value: XmlRange): Promise<void> {
    this.check(); if (this.state !== 'open') throw new OfficeError('invalid-handle', 'Ordered inventory is sealed.', 'index');
    const stored = await this.values.store(sortKey(key)), pointer = this.pages.allocate(40);
    await this.write(pointer, [0, stored.start, stored.length, value.start, value.length]);
    if (this.tail) await this.write(this.tail, [pointer]); else this.head = pointer; this.tail = pointer;
  }
  private async compare(left: number[], right: number[]) {
    const a = this.values.read({ start: left[1]!, length: left[2]! })[Symbol.asyncIterator]();
    const b = this.values.read({ start: right[1]!, length: right[2]! })[Symbol.asyncIterator]();
    let x: Uint8Array = new Uint8Array(), y: Uint8Array = new Uint8Array(), i = 0, j = 0, ae = false, be = false, failed = false;
    try {
      for (;;) {
        this.check();
        while (i === x.length && !ae) { const next = await a.next(); ae = !!next.done; x = ae ? new Uint8Array() : new Uint8Array(next.value); i = 0; }
        while (j === y.length && !be) { const next = await b.next(); be = !!next.done; y = be ? new Uint8Array() : new Uint8Array(next.value); j = 0; }
        if (ae || be) return ae === be ? 0 : ae ? -1 : 1;
        const count = Math.min(x.length - i, y.length - j);
        for (let n = 0; n < count; n++) if (x[i + n] !== y[j + n]) return x[i + n]! < y[j + n]! ? -1 : 1;
        i += count; j += count;
      }
    } catch (error) { failed = true; throw error; }
    finally {
      const outcomes = await Promise.allSettled([Promise.resolve().then(() => a.return?.()), Promise.resolve().then(() => b.return?.())]);
      if (!failed) for (const outcome of outcomes) if (outcome.status === 'rejected') await Promise.reject(outcome.reason);
    }
  }
  async seal(): Promise<void> {
    this.check(); if (this.state === 'ready') return;
    if (this.state !== 'open') throw new OfficeError('invalid-handle', 'Ordered inventory cannot be sealed.', 'index');
    this.state = 'sorting';
    try {
      for (let width = 1; this.head; width *= 2) {
        let p = this.head, head = 0, tail = 0, merges = 0;
        while (p) {
          merges++; let q = p, left = 0, right = width;
          for (let n = 0; n < width && q; n++) { left++; q = (await this.row(q))[0]!; }
          while (left || right && q) {
            let next: number;
            if (!left) { next = q; q = (await this.row(q))[0]!; right--; }
            else if (!right || !q) { next = p; p = (await this.row(p))[0]!; left--; }
            else {
              const a = await this.row(p), b = await this.row(q);
              if (await this.compare(a, b) <= 0) { next = p; p = a[0]!; left--; }
              else { next = q; q = b[0]!; right--; }
            }
            if (tail) await this.write(tail, [next]); else head = next; tail = next;
          }
          p = q;
        }
        await this.write(tail, [0]); this.head = head; this.tail = tail;
        if (merges <= 1) break;
      }
      this.state = 'ready';
    } catch (error) { this.state = 'failed'; throw error; }
  }
  async *entries(): AsyncGenerator<XmlRange> {
    this.check(); if (this.state !== 'ready') throw new OfficeError('invalid-handle', 'Ordered inventory is not sealed.', 'index');
    for (let pointer = this.head; pointer;) { const data = await this.row(pointer); yield { start: data[3]!, length: data[4]! }; pointer = data[0]!; }
  }
}
