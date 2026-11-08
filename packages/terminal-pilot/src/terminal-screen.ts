import { stripAnsi } from "./ansi.js";

export class TerminalScreen {
  readonly lines: readonly string[];
  readonly rawLines: readonly string[];
  readonly cursor: { row: number; col: number };
  readonly size: { rows: number; cols: number };

  constructor({
    lines,
    rawLines,
    cursor,
    size
  }: {
    lines: string[];
    rawLines: string[];
    cursor: { row: number; col: number };
    size: { rows: number; cols: number };
  }) {
    this.lines = Object.freeze(lines.map((line) => stripAnsi(line)));
    this.rawLines = Object.freeze([...rawLines]);
    this.cursor = Object.freeze({ ...cursor });
    this.size = Object.freeze({ ...size });

    Object.freeze(this);
  }

  get text(): string {
    return this.lines.join("\n");
  }

  contains(substring: string): boolean {
    return this.text.includes(substring);
  }

  line(index: number): string {
    const normalizedIndex = index < 0 ? this.lines.length + index : index;
    const line = this.lines[normalizedIndex];

    if (line === undefined) {
      throw new RangeError(`Line index out of bounds: ${index}`);
    }

    return line;
  }
}
