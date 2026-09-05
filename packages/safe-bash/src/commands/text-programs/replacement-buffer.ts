import { Budget, ProgramError } from "./shared.js";

export class ReplacementBuffer {
  #segments: Buffer[] = [];
  #size = 0;
  #allocated = 0;
  #tailUsed = 0;

  constructor(readonly budget: Budget) {}

  get remaining(): number { return this.budget.maxBufferBytes - this.#size; }

  admit(length: number): void {
    this.budget.step(0);
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) throw new ProgramError("text buffer limit exceeded");
  }

  async append(source: string, start = 0, end = source.length): Promise<void> {
    this.admit(end - start);
    let offset = start;
    while (offset < end) {
      await this.budget.checkpoint();
      let tail = this.#segments.at(-1);
      const available = tail ? tail.length - this.#tailUsed : 0;
      const capacity = Math.min(1024, this.budget.maxBufferBytes - this.#allocated);
      const length = Math.min(end - offset, available || capacity);
      this.budget.step(length);
      if (!available) {
        this.budget.step();
        tail = Buffer.allocUnsafeSlow(capacity);
        this.#segments.push(tail);
        this.#allocated += capacity;
        this.#tailUsed = 0;
      }
      for (let index = 0; index < length; index++) tail![this.#tailUsed + index] = source.charCodeAt(offset + index);
      this.#tailUsed += length;
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
    if (this.#segments.length === 1) {
      const text = this.#segments[0]!.toString("latin1", 0, this.#size);
      this.clear();
      return text;
    }
    this.budget.step(this.#size);
    if (this.#allocated > this.budget.maxBufferBytes || this.#size > this.budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    const result = Buffer.allocUnsafeSlow(this.#size);
    let offset = 0;
    for (const segment of this.#segments) {
      await this.budget.checkpoint();
      this.budget.step(0);
      const length = Math.min(segment.length, this.#size - offset);
      result.set(segment.subarray(0, length), offset);
      offset += length;
    }
    this.clear();
    await this.budget.checkpoint();
    this.budget.step(0);
    return result.toString("latin1");
  }

  clear(): void {
    this.#segments = [];
    this.#size = 0;
    this.#allocated = 0;
    this.#tailUsed = 0;
  }
}
