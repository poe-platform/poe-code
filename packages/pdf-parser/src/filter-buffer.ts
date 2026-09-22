import type { SyntaxReader } from "./syntax.js";
/** Conservative cumulative allocation accounting includes staging and final copies. */
export class FilterOutput {
  readonly values: number[] = [];
  constructor(readonly budget: SyntaxReader) {}
  push(value: number): void {
    this.budget.charge();
    this.budget.expand(1);
    this.budget.reserve(9);
    this.values.push(value & 255);
  }
  finish(): Uint8Array {
    this.budget.charge(this.values.length);
    this.budget.reserve(this.values.length);
    return Uint8Array.from(this.values);
  }
}
export class FilterBits {
  private position = 0;
  constructor(
    private readonly data: Uint8Array,
    private readonly budget: SyntaxReader,
    private readonly little: boolean
  ) {}
  read(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) {
      this.budget.charge();
      if (this.position >= this.data.length * 8)
        this.budget.fail("SYNTAX", "truncated filter bits");
      const byte = this.data[Math.floor(this.position / 8)]!;
      const bit = this.little
        ? (byte >> (this.position % 8)) & 1
        : (byte >> (7 - (this.position % 8))) & 1;
      value = this.little ? value + bit * 2 ** i : value * 2 + bit;
      this.position++;
    }
    return value;
  }
  align(): void {
    this.position = Math.ceil(this.position / 8) * 8;
  }
  get consumed(): number {
    return Math.ceil(this.position / 8);
  }
}
