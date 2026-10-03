import { PagedStorage } from "@poe-code/safe-fs/storage";
import { ZipDirectoryIndex } from "@poe-code/office-package/zip";
import { sha256 } from "@noble/hashes/sha2.js";
import type { ByteSource } from "./contracts.js";
import type { XmlRange } from "./retained-xml.js";

export async function* literal(value: string): ByteSource {
  const encoder = new TextEncoder();
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(value.length, offset + 4096);
    if (end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) end--;
    yield encoder.encode(value.slice(offset, end)); offset = end;
  }
}
export async function equal(left: ByteSource, right: ByteSource): Promise<boolean> {
  const a = left[Symbol.asyncIterator](), b = right[Symbol.asyncIterator]();
  let x: Uint8Array = new Uint8Array(), y: Uint8Array = new Uint8Array(), i = 0, j = 0, ae = false, be = false;
  let failed = false;
  try {
    for (;;) {
      while (i === x.length && !ae) { const next = await a.next(); ae = Boolean(next.done); x = ae ? new Uint8Array() : new Uint8Array(next.value); i = 0; }
      while (j === y.length && !be) { const next = await b.next(); be = Boolean(next.done); y = be ? new Uint8Array() : new Uint8Array(next.value); j = 0; }
      if (ae || be) return ae && be;
      const count = Math.min(x.length - i, y.length - j);
      for (let n = 0; n < count; n++) if (x[i + n] !== y[j + n]) return false;
      i += count; j += count;
    }
  } catch (error) { failed = true; throw error; }
  finally {
    const outcomes = await Promise.allSettled([Promise.resolve().then(() => a.return?.()), Promise.resolve().then(() => b.return?.())]);
    if (!failed) { const failure = outcomes.find(outcome => outcome.status === "rejected"); if (failure?.status === "rejected") await Promise.reject(failure.reason); }
  }
}
export async function digest(...sources: ByteSource[]): Promise<string> {
  const hash = sha256.create();
  for (const source of sources) for await (const bytes of source) hash.update(bytes);
  return Array.from(hash.digest(), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function* characters(source: ByteSource): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for await (const bytes of source) for (const character of decoder.decode(bytes, { stream: true })) yield character;
  yield* decoder.decode();
}
export async function* folded(source: ByteSource): ByteSource {
  for await (const bytes of source) {
    const owned = new Uint8Array(bytes);
    for (let n = 0; n < owned.length; n++) if (owned[n]! >= 65 && owned[n]! <= 90) owned[n]! += 32;
    yield owned;
  }
}

/** Internal serialized writer: variable-length keys and collision chains live in
 * caller pages, while directory keys have fixed length. Readers may interleave. */
export class RetainedValues {
  private readonly index: ZipDirectoryIndex;
  constructor(private readonly pages: PagedStorage, private readonly check: () => void, signal: AbortSignal) {
    this.index = new ZipDirectoryIndex(pages, { signal });
  }
  async store(source: ByteSource): Promise<XmlRange> {
    this.check(); const start = this.pages.allocate(0); let length = 0;
    for await (const bytes of source) for (let offset = 0; offset < bytes.length; offset += 16384) {
      this.check(); const owned = new Uint8Array(bytes.subarray(offset, offset + 16384));
      await this.pages.append(owned); length += owned.length;
    }
    return { start, length };
  }
  async *read(range: XmlRange): ByteSource {
    this.check();
    for (let offset = 0; offset < range.length; offset += 16384) {
      this.check(); yield await this.pages.read(range.start + offset, Math.min(16384, range.length - offset));
    }
  }
  async find(scope: string, key: () => ByteSource): Promise<XmlRange | undefined> {
    this.check(); let pointer = await this.index.get(`${scope}:${await digest(key())}`) ?? 0;
    while (pointer) {
      this.check(); const bytes = await this.pages.read(pointer, 40), view = new DataView(bytes.buffer, bytes.byteOffset, 40);
      if (await equal(key(), this.read({ start: view.getFloat64(8, true), length: view.getFloat64(16, true) })))
        return { start: view.getFloat64(24, true), length: view.getFloat64(32, true) };
      pointer = view.getFloat64(0, true);
    }
    return undefined;
  }
  async insert(scope: string, key: XmlRange, value: XmlRange): Promise<boolean> {
    this.check(); if (await this.find(scope, () => this.read(key))) return false;
    const hash = `${scope}:${await digest(this.read(key))}`, previous = await this.index.get(hash) ?? 0;
    const bytes = new Uint8Array(40), view = new DataView(bytes.buffer);
    [previous, key.start, key.length, value.start, value.length].forEach((number, n) => view.setFloat64(n * 8, number, true));
    const pointer = this.pages.allocate(40); await this.pages.write(pointer, bytes); await this.index.set(hash, pointer);
    return true;
  }
}
