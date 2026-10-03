import type {PagedStorage} from "safe-bash-io-engine/storage";

export type TextRange = {first: number; last: number; units: number};
export const emptyText = (): TextRange => ({first: 0, last: 0, units: 0});

/** UTF-16 text pieces in caller storage. Concatenation transfers ownership of
 * the source chain; transforms read their inputs without modifying them. */
export class BackedText {
  constructor(private readonly storage: PagedStorage, private readonly cooperate: (units?: number) => Promise<void>) {}
  async append(target: TextRange, source: TextRange): Promise<void> {
    if (!source.units) return;
    if (target.last) {
      const bytes = new Uint8Array(8);
      new DataView(bytes.buffer).setFloat64(0, source.first, true);
      await this.storage.write(target.last, bytes);
    } else target.first = source.first;
    target.last = source.last;
    target.units += source.units;
  }
  async from(source: Iterable<string> | AsyncIterable<string>): Promise<TextRange> {
    const result = emptyText();
    for await (const text of source) for (let offset = 0; offset < text.length; offset += 4096) {
      const count = Math.min(4096, text.length - offset), bytes = new Uint8Array(16 + count * 2);
      const view = new DataView(bytes.buffer);
      view.setFloat64(8, count, true);
      for (let i = 0; i < count; i++) view.setUint16(16 + i * 2, text.charCodeAt(offset + i), true);
      const position = await this.storage.append(bytes);
      await this.append(result, {first: position, last: position, units: count});
      await this.cooperate(count);
    }
    return result;
  }
  async *chunks(value: TextRange): AsyncGenerator<string> {
    let position = value.first;
    while (position) {
      const header = await this.storage.read(position, 16), view = new DataView(header.buffer, header.byteOffset, header.length);
      const count = view.getFloat64(8, true);
      const bytes = await this.storage.read(position + 16, count * 2), text = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      let chunk = "";
      for (let i = 0; i < count; i++) chunk += String.fromCharCode(text.getUint16(i * 2, true));
      await this.cooperate(count);
      yield chunk;
      if (position === value.last) break;
      position = view.getFloat64(0, true);
    }
  }
  /** Chunk boundaries never split a surrogate pair; unpaired units are retained. */
  async *unicodeChunks(value: TextRange): AsyncGenerator<string> {
    let pending = "";
    for await (const chunk of this.chunks(value)) {
      const text = pending + chunk, last = text.charCodeAt(text.length - 1);
      const end = last >= 0xd800 && last <= 0xdbff ? text.length - 1 : text.length;
      pending = text.slice(end);
      if (end) yield text.slice(0, end);
    }
    if (pending) yield pending;
  }
  /** Unicode default lowercase, including final sigma over arbitrarily long
   * case-ignorable runs. A provisional sigma is patched in caller storage. */
  async lower(value: TextRange): Promise<TextRange> {
    const output = emptyText();
    let buffer = "", cased = false, sigma = 0;
    const flush = async () => {
      if (buffer) {await this.append(output, await this.from([buffer])); buffer = "";}
    };
    const finalSigma = async () => {
      const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, 0x3c2, true);
      await this.storage.write(sigma, bytes); sigma = 0;
    };
    for await (const chunk of this.unicodeChunks(value)) for (const char of chunk) {
      const ignorable = /\p{Case_Ignorable}/u.test(char), isCased = /\p{Cased}/u.test(char);
      if (!ignorable && sigma) {if (!isCased) await finalSigma(); else sigma = 0;}
      if (char === "Σ" && cased) {
        await flush();
        const piece = await this.from(["σ"]);
        sigma = piece.first + 16; await this.append(output, piece);
      } else buffer += char.toLowerCase();
      if (!ignorable) cased = isCased;
      if (buffer.length >= 4096) await flush();
    }
    if (sigma) await finalSigma();
    await flush();
    return output;
  }
  /** Linear UTF-16 substring search. Both pattern units and failure links live
   * in caller storage; only one source chunk and scalar cursors stay resident. */
  async includes(value: TextRange, needle: TextRange): Promise<boolean> {
    if (!needle.units) return true;
    if (needle.units > value.units) return false;
    if (needle.units <= 4096) {
      let key = "", tail = "";
      for await (const chunk of this.chunks(needle)) key += chunk;
      for await (const chunk of this.chunks(value)) {
        const window = tail + chunk;
        if (window.includes(key)) return true;
        tail = key.length > 1 ? window.slice(1 - key.length) : "";
      }
      return false;
    }
    const pattern = this.storage.allocate(needle.units * 10);
    let offset = 0;
    for await (const chunk of this.chunks(needle)) {
      const bytes = new Uint8Array(chunk.length * 10), view = new DataView(bytes.buffer);
      for (let i = 0; i < chunk.length; i++) view.setUint16(i * 10, chunk.charCodeAt(i), true);
      await this.storage.write(pattern + offset * 10, bytes); offset += chunk.length;
    }
    const entry = async (index: number) => {
      const bytes = await this.storage.read(pattern + index * 10, 10), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      return {unit: view.getUint16(0, true), prefix: view.getFloat64(2, true)};
    };
    let matched = 0;
    for (let i = 1; i < needle.units; i++) {
      const unit = (await entry(i)).unit;
      while (matched && unit !== (await entry(matched)).unit) matched = (await entry(matched - 1)).prefix;
      if (unit === (await entry(matched)).unit) matched++;
      const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, matched, true);
      await this.storage.write(pattern + i * 10 + 2, bytes); await this.cooperate();
    }
    matched = 0;
    for await (const chunk of this.chunks(value)) for (let i = 0; i < chunk.length; i++) {
      const unit = chunk.charCodeAt(i);
      while (matched && unit !== (await entry(matched)).unit) matched = (await entry(matched - 1)).prefix;
      if (unit === (await entry(matched)).unit) matched++;
      if (matched === needle.units) return true;
      await this.cooperate();
    }
    return false;
  }
  async trimFinalNewline(value: TextRange): Promise<TextRange> {
    const source = this.chunks(value);
    return this.from((async function* () {
      let pending = "";
      for await (const chunk of source) {
        const text = pending + chunk;
        pending = text.slice(-1);
        yield text.slice(0, -1);
      }
      if (pending !== "\n") yield pending;
    })());
  }
  async indent(value: TextRange, first: string, rest: string): Promise<TextRange> {
    const source = this.chunks(value);
    return this.from((async function* () {
      let start = true, initial = true, output = "";
      for await (const chunk of source) for (const char of chunk) {
        if (char === "\n") {start = true; initial = false;}
        else if (start) {output += initial ? first : rest; start = false;}
        output += char;
        if (output.length >= 4096) {yield output; output = "";}
      }
      if (output) yield output;
    })());
  }
  async wrap(value: TextRange, width: number): Promise<TextRange> {
    const output = emptyText();
    let word = emptyText(), buffer = "", wordWidth = 0, lineWidth = 0, pending = "";
    const flush = async () => {
      if (!wordWidth) return;
      if (buffer) {await this.append(word, await this.from([buffer])); buffer = "";}
      if (lineWidth) {
        if (lineWidth + 1 + wordWidth > width) {await this.append(output, await this.from(["\n"])); lineWidth = 0;}
        else {await this.append(output, await this.from([" "])); lineWidth++;}
      }
      await this.append(output, word); lineWidth += wordWidth;
      word = emptyText(); wordWidth = 0;
    };
    const process = async (text: string) => {
      for (const char of text) {
        if (char === " " || char === "\t" || char === "\n") {
          await flush();
          if (char === "\n") {await this.append(output, await this.from(["\n"])); lineWidth = 0;}
        } else {
          buffer += char; wordWidth++;
          if (buffer.length >= 4096) {await this.append(word, await this.from([buffer])); buffer = "";}
        }
      }
    };
    for await (const chunk of this.chunks(value)) {
      const text = pending + chunk, last = text.charCodeAt(text.length - 1);
      const end = last >= 0xd800 && last <= 0xdbff ? text.length - 1 : text.length;
      pending = text.slice(end);
      await process(text.slice(0, end));
    }
    await process(pending); await flush();
    return output;
  }
}
