import type { ByteSource, CodecProvider } from "../contracts.js";
import { defaultSniffStreamProfile, type SniffStreamProfile } from "../csv/sniffer-profile.js";
import { CsvkitBlocked, CsvkitDiagnostic } from "../errors.js";

export function virtualPath(cwd: string, path: string): string {
  const parts: string[] = [];
  for (const part of (path.startsWith("/") ? path : `${cwd}/${path}`).split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return "/" + parts.join("/");
}

/** POSIX os.path.splitext: leading dots alone do not begin an extension. */
export function pathExtension(path: string): string {
  const start = path.lastIndexOf("/") + 1;
  const period = path.lastIndexOf(".");
  for (let index = start; index < period; index++)
    if (path[index] !== ".") return path.slice(period);
  return "";
}

/** A delayed text open with one cursor for read and physical-line iteration.
 * Named rt files translate universal newlines; LazyFile iteration alone strips NUL.
 * Stdin is borrowed and keeps its original newline profile until CSV parsing.
 */
export class LazyInput {
  #iterator: AsyncIterator<string> | undefined;
  #pending = "";
  #byteIterator: AsyncIterator<Uint8Array> | undefined;
  #bytePrefix: Uint8Array[] = [];
  #byteDone = false;
  #done = false;
  #readStarted = false;
  #closing: Promise<void> | undefined;
  constructor(readonly name: string, readonly source: () => ByteSource,
    readonly codec: CodecProvider, readonly encoding: string, readonly signal: AbortSignal,
    readonly retain: (size: number) => void, readonly admit: (text: string) => void,
    readonly borrowed = false) {}

  get readStarted(): boolean { return this.#readStarted && !this.#done; }

  async *#bytes(): AsyncGenerator<Uint8Array> {
    try {
      while (this.#bytePrefix.length) yield this.#bytePrefix.shift()!;
      this.#byteIterator ??= this.source()[Symbol.asyncIterator]();
      while (!this.#byteDone) {
        this.assertOpen();
        const next = await this.#byteIterator.next();
        this.assertOpen();
        if (next.done) this.#byteDone = true;
        else yield next.value;
      }
    } finally { await this.#byteIterator?.return?.(); }
  }

  async sniffSample(limit: number, maxCharacters: number, profile: SniffStreamProfile = defaultSniffStreamProfile): Promise<string> {
    this.assertOpen();
    if (!Number.isSafeInteger(limit) || limit < -1 || !Number.isSafeInteger(maxCharacters) || maxCharacters < 0)
      throw new CsvkitBlocked("invalid sniff sample limits");
    if (limit === 0) return "";
    if (this.borrowed && limit > 0) {
      if (this.#iterator) throw new CsvkitBlocked("positive sniffing after decoded stdin cursor advancement");
      if (!Number.isSafeInteger(profile.peekBytes) || profile.peekBytes < 1)
        throw new CsvkitBlocked("invalid stdin sniff stream profile peek budget");
      this.#byteIterator ??= this.source()[Symbol.asyncIterator]();
      let size = this.#bytePrefix.reduce((sum, chunk) => sum + chunk.length, 0);
      while (size < profile.peekBytes && !this.#byteDone) {
        this.assertOpen();
        const next = await this.#byteIterator.next();
        this.assertOpen();
        if (next.done) this.#byteDone = true;
        else { this.retain(next.value.length); this.#bytePrefix.push(Uint8Array.from(next.value)); size += next.value.length; }
      }
      const peekLength = Math.min(size, profile.peekBytes);
      this.retain(peekLength);
      const peek = new Uint8Array(peekLength);
      let offset = 0;
      for (const chunk of this.#bytePrefix) {
        const part = chunk.subarray(0, peek.length - offset);
        peek.set(part, offset); offset += part.length;
        if (offset === peek.length) break;
      }
      const text = await profile.decode(peek, this.encoding, this.signal);
      this.assertOpen();
      this.retain(text.length * 2);
      let sample = "", count = 0;
      for (const char of text) {
        if (count === limit) break;
        if (++count > maxCharacters) throw new CsvkitBlocked("sniff sample character budget exceeded");
        this.retain(char.length * 2);
        sample += char;
      }
      return sample;
    }
    let scanned = 0, count = 0;
    while (true) {
      while (scanned < this.#pending.length) {
        const value = this.#pending.codePointAt(scanned)!;
        if (value >= 0xd800 && value <= 0xdbff && scanned + 1 === this.#pending.length && !this.#done) break;
        scanned += value > 0xffff ? 2 : 1;
        if (++count > maxCharacters) throw new CsvkitBlocked("sniff sample character budget exceeded");
        if (count === limit) return this.#pending.slice(0, scanned);
      }
      if (this.#done) return this.#pending;
      await this.#fill();
    }
  }

  async *#decode(): AsyncGenerator<string> {
    let chunks: AsyncIterable<string>;
    if (this.codec.decodeStream) chunks = this.codec.decodeStream(this.#bytes(), this.encoding, this.signal);
    else {
      const bytes: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of this.#bytes()) {
        this.signal.throwIfAborted();
        this.retain(chunk.length);
        bytes.push(Uint8Array.from(chunk));
        size += chunk.length;
      }
      this.retain(size);
      const joined = new Uint8Array(size);
      let offset = 0;
      for (const chunk of bytes) { joined.set(chunk, offset); offset += chunk.length; }
      const text = await this.codec.decode(joined, this.encoding, this.signal);
      chunks = (async function* () { yield text; })();
    }
    let cr = false;
    for await (const text of chunks) {
      this.signal.throwIfAborted();
      if (text.length) this.#readStarted = true;
      this.retain(text.length * 2);
      this.admit(text);
      if (this.borrowed) { yield text; continue; }
      let normalized = "";
      for (const char of text) {
        if (cr && char === "\n") { cr = false; continue; }
        cr = char === "\r";
        normalized += cr ? "\n" : char;
      }
      yield normalized;
    }
  }

  async #fill(): Promise<void> {
    this.signal.throwIfAborted();
    if (this.#closing) throw new CsvkitDiagnostic("ValueError: I/O operation on closed file.");
    this.#iterator ??= this.#decode()[Symbol.asyncIterator]();
    const next = await this.#iterator.next();
    this.signal.throwIfAborted();
    if (next.done) this.#done = true;
    else this.#pending += next.value;
  }

  async nextLine(stripNul = !this.borrowed): Promise<string | null> {
    scan: while (true) {
      this.signal.throwIfAborted();
      if (this.#closing) throw new CsvkitDiagnostic("ValueError: I/O operation on closed file.");
      for (let index = 0; index < this.#pending.length; index++) {
        const char = this.#pending[index];
        if (char !== "\n" && (this.borrowed || char !== "\r")) continue;
        if (char === "\r" && index + 1 === this.#pending.length && !this.#done) { await this.#fill(); continue scan; }
        const end = index + (char === "\r" && this.#pending[index + 1] === "\n" ? 2 : 1);
        const line = this.#pending.slice(0, end);
        this.#pending = this.#pending.slice(end);
        return stripNul ? line.split("\0").join("") : line;
      }
      if (this.#done) {
        if (!this.#pending) return null;
        const line = this.#pending; this.#pending = "";
        return stripNul ? line.split("\0").join("") : line;
      }
      await this.#fill();
    }
  }

  async read(skipped = 0): Promise<string> {
    this.signal.throwIfAborted();
    if (this.#closing) throw new CsvkitDiagnostic("ValueError: I/O operation on closed file.");
    for (let count = 0; count < skipped; count++) if (await this.nextLine(false) === null) break;
    while (!this.#done) await this.#fill();
    const text = this.#pending; this.#pending = "";
    return text;
  }

  async *lines(skipped = 0): AsyncGenerator<string> {
    for (let count = 0; count < skipped; count++) if (await this.nextLine() === null) return;
    while (true) { const line = await this.nextLine(); if (line === null) return; yield line; }
  }

  readonly close = (): Promise<void> => this.#closing ??= Promise.resolve().then(async () => {
    this.#pending = "";
    await this.#iterator?.return?.();
    if (!this.#iterator) await this.#byteIterator?.return?.();
    this.#bytePrefix = [];
  });
  assertOpen(): void {
    this.signal.throwIfAborted();
    if (this.#closing) throw new CsvkitDiagnostic("ValueError: I/O operation on closed file.");
  }
}
