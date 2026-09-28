import { Budget, ProgramError } from "./budget.js";

export class ReplacementBuffer {
  #segments: (Uint8Array | Uint16Array)[] = [];
  #size = 0;
  #allocated = 0;
  #unboundedText = "";

  constructor(readonly budget: Budget) {}

  get remaining(): number { return this.budget.maxBufferBytes - this.#size; }

  admit(length: number): void {
    this.budget.step(0);
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) throw new ProgramError("text buffer limit exceeded");
  }

  async append(source: string, start = 0, end = source.length): Promise<void> {
    this.admit(end - start);
    if (this.budget.maxBufferBytes === Infinity) {
      let offset = start;
      while (offset < end) {
        await this.budget.checkpoint();
        const length = Math.min(end - offset, 1024);
        this.budget.step(length);
        this.budget.step();
        this.#unboundedText += offset === 0 && length === source.length ? source : source.slice(offset, offset + length);
        this.#size += length;
        offset += length;
      }
      return;
    }
    let offset = start;
    while (offset < end) {
      await this.budget.checkpoint();
      this.budget.step();
      const width = source.charCodeAt(offset) <= 255 ? 1 : 2;
      let length = 1;
      while (length < 1024 && offset + length < end) {
        this.budget.step();
        if ((source.charCodeAt(offset + length) <= 255 ? 1 : 2) !== width) break;
        length++;
      }
      // Exact width runs avoid reserving unused bytes when Latin1 and wide
      // UTF-16 units alternate. Wide units, including lone surrogates, cost two
      // backing bytes even though admit()/remaining count logical units.
      const bytes = length * width;
      if (bytes > this.budget.maxBufferBytes - this.#allocated) throw new ProgramError("text buffer limit exceeded");
      this.budget.step(length + 1);
      const segment = width === 1 ? new Uint8Array(length) : new Uint16Array(length);
      for (let index = 0; index < length; index++) segment[index] = source.charCodeAt(offset + index);
      this.#segments.push(segment);
      this.#allocated += segment.byteLength;
      this.#size += length;
      offset += length;
    }
  }

  async finish(): Promise<string> {
    this.budget.step(0);
    if (!this.#size) return "";
    this.budget.step(this.#size);
    await this.budget.checkpoint();
    this.budget.step(0);
    if (this.budget.maxBufferBytes === Infinity) {
      const text = this.#unboundedText;
      this.clear();
      return text;
    }
    if (this.#segments.length === 1) {
      const text = String.fromCharCode(...this.#segments[0]!.subarray(0, this.#size));
      this.clear();
      return text;
    }
    this.budget.step(this.#size);
    if (this.#allocated > this.budget.maxBufferBytes || this.#size > this.budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    const parts: string[] = [];
    let offset = 0;
    for (const segment of this.#segments) {
      await this.budget.checkpoint();
      this.budget.step(0);
      const length = Math.min(segment.length, this.#size - offset);
      parts.push(String.fromCharCode(...segment.subarray(0, length)));
      offset += length;
    }
    this.clear();
    await this.budget.checkpoint();
    this.budget.step(0);
    return parts.join("");
  }

  clear(): void {
    this.#segments = [];
    this.#size = 0;
    this.#allocated = 0;
    this.#unboundedText = "";
  }
}
