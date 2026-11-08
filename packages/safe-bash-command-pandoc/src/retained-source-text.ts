import type {PagedStorage} from "safe-bash-io-engine/storage";

export interface SourceRange {start: number; end: number}
/** Random-access UTF-16 source spans. Only one small decoded page stays resident. */
export class RetainedSourceText {
  length = 0;
  private readonly start: number;
  private cachedStart = -1;
  private cached = "";
  constructor(private readonly storage: PagedStorage, private readonly cooperate: (units?: number) => Promise<void>) {
    this.start = storage.allocate(0);
  }
  async append(chunks: Iterable<string> | AsyncIterable<string>): Promise<SourceRange> {
    const start = this.length;
    for await (const chunk of chunks) for (let offset = 0; offset < chunk.length; offset += 4096) {
      const size = Math.min(4096, chunk.length - offset), bytes = new Uint8Array(size * 2), view = new DataView(bytes.buffer);
      for (let i = 0; i < size; i++) view.setUint16(i * 2, chunk.charCodeAt(offset + i), true);
      await this.storage.append(bytes); this.length += size;
      await this.cooperate(size);
    }
    return {start, end: this.length};
  }
  async unit(index: number): Promise<string> {
    if (index < 0 || index >= this.length) return "";
    if (index < this.cachedStart || index >= this.cachedStart + this.cached.length) {
      this.cachedStart = Math.floor(index / 4096) * 4096;
      const bytes = await this.storage.read(this.start + this.cachedStart * 2, Math.min(4096, this.length - this.cachedStart) * 2);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      this.cached = "";
      for (let i = 0; i < bytes.length; i += 2) this.cached += String.fromCharCode(view.getUint16(i, true));
      await this.cooperate();
    }
    return this.cached[index - this.cachedStart]!;
  }
  async *chunks(range: SourceRange): AsyncGenerator<string> {
    for (let offset = range.start; offset < range.end; offset += 4096) {
      const size = Math.min(4096, range.end - offset), bytes = await this.storage.read(this.start + offset * 2, size * 2);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length); let text = "";
      for (let i = 0; i < size; i++) text += String.fromCharCode(view.getUint16(i * 2, true));
      await this.cooperate(size); yield text;
    }
  }
  async starts(range: SourceRange, value: string): Promise<boolean> {
    if (range.end - range.start < value.length) return false;
    for (let i = 0; i < value.length; i++) if (await this.unit(range.start + i) !== value[i]) return false;
    return true;
  }
  async find(range: SourceRange, value: string): Promise<number> {
    for (let i = range.start; i <= range.end - value.length; i++) {
      if (await this.starts({start: i, end: range.end}, value)) return i;
      if ((i - range.start) % 256 === 0) await this.cooperate(256);
    }
    return -1;
  }
  async trim(range: SourceRange): Promise<SourceRange> {
    let {start, end} = range;
    while (start < end && !(await this.unit(start)).trim()) {start++; if (start % 256 === 0) await this.cooperate(256);}
    while (end > start && !(await this.unit(end - 1)).trim()) {end--; if (end % 256 === 0) await this.cooperate(256);}
    return {start, end};
  }
}
