import { yieldTurn } from "safe-bash-contracts/yield";
import type { MdqBudget } from "./budget.js";

export type WriterBlock = "plain" | "quote" | { readonly indent: number };
type Block = "plain" | "quote" | number;
type Action = (writer: MdqWriter) => void | Promise<void>;
interface Range { start: number; end: number; includeIndents: boolean }
interface Indentation { newlines: number; between: Range; last: Range }

/** mdq v0.10.0's word-buffer and block-indentation state, with owned bounded output. */
export class MdqWriter {
  private readonly blocks: Block[] = [];
  private readonly pendingBlocks: Block[] = [];
  private pendingNewlines = 0;
  private preMode = false;
  private hasWritten = false;
  private readonly parts: string[] = [];
  private readonly characters: string[] = [];
  private characterStorage = false;
  private bytes = 0;
  private units = 0;
  private finished: string | undefined;
  private readonly pendingWord: string[] = [];
  private writtenToLine = 0;
  private firstWord = true;
  private shortenLineBy = 0;
  private whitespaceBoundary: boolean;

  constructor(private readonly budget: MdqBudget, private readonly width?: number) {
    if (width !== undefined && (!Number.isSafeInteger(width) || width < 0)) throw new RangeError("Invalid Markdown wrap width");
    this.whitespaceBoundary = width !== undefined;
  }

  async write(text: string): Promise<void> {
    this.checkOpen();
    let count = 0;
    const output = this.indentedChar.bind(this);
    for (const char of text) {
      this.budget.checkpoint();
      const indentation = this.indentation(char);
      this.shortenLineBy += this.preWrite(indentation, true);
      if (char !== "\n") this.pushWord(char, output);
      if (++count % 4096 === 0) await yieldTurn(this.budget.context.signal);
    }
    await this.budget.cooperate();
  }

  async block(block: WriterBlock, action: Action): Promise<void> {
    this.checkOpen();
    const kind = typeof block === "string" ? block : block.indent;
    if (typeof kind === "number" && (!Number.isSafeInteger(kind) || kind < 0)) throw new RangeError("Invalid Markdown indentation");
    this.budget.bound("depth", this.blocks.length + this.pendingBlocks.length + 1);
    this.budget.charge("retainedBytes", 32);
    this.pendingBlocks.push(kind);
    await action(this);
    this.popBlock();
  }

  async pre(action: (writer: Pick<MdqWriter, "write">) => void | Promise<void>): Promise<void> {
    await this.block("plain", async () => {
      this.preMode = true;
      try {
        await this.withoutWrapping(action);
        this.preWrite(this.indentation(), this.pendingWord.length > 0);
      } finally { this.preMode = false; }
    });
  }

  async withoutWrapping(action: Action): Promise<void> {
    this.checkOpen();
    const previous = this.whitespaceBoundary;
    this.whitespaceBoundary = false;
    try { await action(this); } finally { this.whitespaceBoundary = previous; }
  }

  finish(): string {
    if (this.finished !== undefined) return this.finished;
    this.budget.checkpoint();
    if (this.pendingNewlines > 0) { this.emit("\n"); this.pendingNewlines = 0; }
    this.flushCharacters();
    this.budget.charge("retainedBytes", this.units * 2);
    this.finished = this.parts.join("");
    this.parts.length = 0;
    return this.finished;
  }

  private checkOpen(): void {
    this.budget.context.signal.throwIfAborted();
    if (this.finished !== undefined) throw new Error("Markdown writer is closed");
  }

  private emit(char: string): void {
    const code = char.codePointAt(0)!;
    const bytes = code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
    this.budget.bound("outputBytes", this.bytes + bytes);
    this.budget.charge("retainedBytes", char.length * 2);
    if (!this.characterStorage) {
      this.budget.charge("retainedBytes", 16_384);
      this.characterStorage = true;
    }
    this.bytes += bytes; this.units += char.length; this.hasWritten = true;
    this.characters.push(char);
    if (this.characters.length === 1024) this.flushCharacters();
  }

  private flushCharacters(): void {
    if (!this.characters.length) return;
    let units = 0;
    for (const char of this.characters) units += char.length;
    this.budget.charge("retainedBytes", units * 2 + 8);
    this.parts.push(this.characters.join(""));
    this.characters.length = 0;
  }

  private ensureNewlines(count: number, exact: boolean, ignore = false): void {
    if (!this.hasWritten || ignore) return;
    this.pendingNewlines = exact ? this.preMode ? this.pendingNewlines + count : count : Math.max(this.pendingNewlines, count);
  }

  private indentation(char?: string): Indentation {
    const result: Indentation = {
      newlines: 0,
      between: { start: 0, end: 0, includeIndents: false },
      last: { start: 0, end: 0, includeIndents: false }
    };
    const first = this.pendingBlocks[0], ignore = typeof first === "number";
    if (first !== undefined && !ignore) this.ensureNewlines(2, false);
    if (char === "\n") { this.ensureNewlines(1, true, ignore); return result; }
    let full: boolean;
    if (this.pendingNewlines > 0) {
      result.newlines = this.pendingNewlines; this.pendingNewlines = 0;
      result.between = { start: 0, end: this.blocks.length, includeIndents: true };
      full = true;
    } else full = !this.hasWritten;
    if (full) {
      const firstIndent = this.pendingBlocks.findIndex(block => typeof block === "number");
      result.last = { start: 0, end: this.blocks.length + (firstIndent < 0 ? this.pendingBlocks.length : firstIndent), includeIndents: true };
    } else result.last = { start: this.blocks.length, end: this.blocks.length + this.pendingBlocks.length, includeIndents: false };
    this.blocks.push(...this.pendingBlocks); this.pendingBlocks.length = 0;
    return result;
  }

  private writeIndent(range: Range, trailingPadding: boolean): number {
    let padding = 0, wrote = 0;
    for (let i = range.start; i < range.end; i++) {
      const block = this.blocks[i];
      if (block === "quote") {
        this.budget.bound("outputBytes", this.bytes + padding + 1);
        this.budget.checkpoint(padding + 1);
        for (let j = 0; j < padding; j++) this.emit(" ");
        this.emit(">"); wrote += padding + 1; padding = 1;
      } else if (typeof block === "number" && range.includeIndents) padding += block;
    }
    if (trailingPadding) {
      this.budget.bound("outputBytes", this.bytes + padding);
      this.budget.checkpoint(padding);
      for (let j = 0; j < padding; j++) this.emit(" ");
      wrote += padding;
    }
    return wrote;
  }

  private preWrite(info: Indentation, trailingPadding: boolean): number {
    if (info.newlines > 0) {
      this.budget.bound("outputBytes", this.bytes + info.newlines);
      for (let i = 0; i < info.newlines - 1; i++) { this.emit("\n"); this.writeIndent(info.between, false); }
      this.emit("\n");
    }
    return this.writeIndent(info.last, trailingPadding);
  }

  private indentedChar(char: string): number {
    this.emit(char);
    return char === "\n" ? this.writeIndent({ start: 0, end: this.blocks.length, includeIndents: true }, true) : 0;
  }

  private popBlock(): void {
    if (this.pendingWord.length) {
      const indentation = this.indentation();
      this.preWrite(indentation, true);
      this.drainPending(char => { this.indentedChar(char); return 0; });
    }
    this.resetWords();
    if (this.pendingBlocks.length) this.preWrite(this.indentation(), this.pendingWord.length > 0);
    const closed = this.blocks.pop();
    this.ensureNewlines(closed === undefined ? 0 : typeof closed === "number" ? 1 : 2, true);
  }

  private pushWord(char: string, action: (char: string) => number): void {
    const code = char.codePointAt(0)!;
    const whitespace = code >= 9 && code <= 13 || code === 32 || code === 0x85 || code === 0xa0 || code === 0x1680 ||
      code >= 0x2000 && code <= 0x200a || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000;
    if (char === "\n") this.newWordLine(action);
    else if (this.whitespaceBoundary && whitespace) {
      if (this.writtenToLine === 0) return;
      if (this.pendingWord.length > 0) {
        if (this.writtenToLine + this.pendingWord.length < this.lineLength()) { this.drainPending(action); this.firstWord = false; }
        else { this.newWordLine(action); this.drainWord(action); }
      } else this.firstWord = false;
    } else if (this.firstWord) {
      this.shortenLineBy += action(char); this.writtenToLine++;
    } else if (this.writtenToLine + this.pendingWord.length + 2 > this.lineLength()) {
      this.newWordLine(action); this.drainWord(action);
      this.shortenLineBy += action(char); this.writtenToLine++;
    } else {
      this.budget.charge("retainedBytes", char.length * 2 + 16);
      this.pendingWord.push(char);
    }
  }

  private lineLength(): number { return Math.max(0, (this.width ?? 0) - this.shortenLineBy); }
  private resetWords(): void { this.writtenToLine = 0; this.firstWord = true; this.shortenLineBy = 0; }
  private newWordLine(action: (char: string) => number): void {
    const shortened = action("\n"); this.resetWords(); this.shortenLineBy += shortened;
  }
  private drainWord(action: (char: string) => number): void {
    this.budget.checkpoint(this.pendingWord.length);
    for (const char of this.pendingWord) this.shortenLineBy += action(char);
    this.writtenToLine += this.pendingWord.length; this.pendingWord.length = 0;
  }
  private drainPending(action: (char: string) => number): void {
    if (!this.pendingWord.length) return;
    this.shortenLineBy += action(" "); this.writtenToLine++;
    this.drainWord(action);
  }
}
