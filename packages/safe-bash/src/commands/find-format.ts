import { FsError, type CommandContext, type FileStat } from "../contracts/index.js";
import { shellValueByteLength, shellValueBytes, type ShellValue } from "../contracts/value.js";
import { yieldTurn } from "../contracts/yield.js";
import { output, UsageError } from "./internal.js";

export interface FindFormatEntry {
  readonly display: string;
  readonly root: string;
  readonly relative: string;
  readonly depth: number;
  readonly stat: FileStat;
}

type Part = { readonly start: number; readonly end: number } | { readonly directive: string } | { readonly byte: number };
const controls: Readonly<Record<number, number>> = { 97: 7, 98: 8, 102: 12, 110: 10, 114: 13, 116: 9, 118: 11, 92: 92 };

/** Invocation-wide limits apply across every format action and matched entry. */
export class FindFormatBudget {
  private arguments = 0;
  private steps = 0;
  private bytes = 0;
  private untilYield = 4096;
  exhausted = false;

  constructor(readonly context: CommandContext) {}

  fail(label: string): never {
    this.exhausted = true;
    throw new FsError("EFBIG", { message: `find printf ${label} limit exceeded` });
  }

  admitFormat(length: number): void {
    this.arguments += length;
    if (this.arguments > 65536) throw new UsageError("printf format byte limit exceeded (65536)");
  }

  async step(count = 1): Promise<void> {
    this.context.signal.throwIfAborted();
    this.steps += count;
    if (this.steps > 32 * 1024 * 1024) this.fail("work");
    this.untilYield -= count;
    if (this.untilYield <= 0) {
      this.untilYield = 4096;
      await yieldTurn(this.context.signal);
    }
  }

  async write(bytes: Uint8Array): Promise<void> {
    this.admitOutput(bytes.length);
    this.bytes += bytes.length;
    for (let offset = 0; offset < bytes.length; offset += 4096) {
      const chunk = bytes.subarray(offset, offset + 4096);
      await this.step(chunk.length);
      await output(this.context, chunk);
    }
  }

  admitOutput(length: number): void {
    if (length > 8 * 1024 * 1024 - this.bytes) this.fail("output");
  }

  async text(text: string): Promise<void> {
    this.admitOutput(text.length);
    // Bound each encoding allocation independently of the full pathname length.
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(text.length, offset + 1024);
      if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--;
      const part = text.slice(offset, end);
      const length = Buffer.byteLength(part);
      this.admitOutput(length);
      await this.write(Buffer.from(part));
      offset = end;
    }
  }
}

async function field(entry: FindFormatEntry, code: string, budget: FindFormatBudget): Promise<string> {
  if (code === "p") return entry.display;
  if (code === "P") return entry.relative;
  if (code === "H") return entry.root;
  if (code === "s") return String(entry.stat.size);
  if (code === "d") return String(entry.depth);
  if (code === "y") return ({ file: "f", directory: "d", symlink: "l", character: "c" })[entry.stat.type];
  let end = entry.display.length;
  while (end > 1 && entry.display[end - 1] === "/") { await budget.step(); end--; }
  let slash = end - 1;
  while (slash >= 0 && entry.display[slash] !== "/") { await budget.step(); slash--; }
  const start = code === "f" ? slash + 1 : 0;
  const finish = code === "f" ? end : slash;
  if (code === "f" && end === 1 && entry.display[0] === "/") return "/";
  if (code === "h" && slash < 0) return ".";
  budget.admitOutput(finish - start);
  // Charge retained substring copying as well as the backwards component scan.
  for (let offset = start; offset < finish; offset += 4096) await budget.step(Math.min(4096, finish - offset));
  return entry.display.slice(start, finish);
}

/** Linear scan in admitted format bytes; no native formatting or regexp engine. */
export async function compileFindFormat(value: ShellValue, budget: FindFormatBudget): Promise<(entry: FindFormatEntry) => Promise<void>> {
  if (typeof value === "string" && value.length > 65536) budget.admitFormat(value.length);
  budget.admitFormat(shellValueByteLength(value));
  const source = shellValueBytes(value);
  const parts: Part[] = [];
  let literal = 0;
  let index = 0;
  const flush = () => { if (index > literal) parts.push({ start: literal, end: index }); };
  while (index < source.length) {
    await budget.step();
    const byte = source[index]!;
    if (byte !== 37 && byte !== 92) { index++; continue; }
    flush();
    const next = source[++index];
    if (byte === 37) {
      if (next === 37) parts.push({ byte: 37 });
      else if (next !== undefined && "pfhsdPHy".includes(String.fromCharCode(next))) parts.push({ directive: String.fromCharCode(next) });
      else throw new UsageError("unsupported printf format directive or modifier");
      index++;
    } else {
      if (next === 99) { literal = source.length; break; }
      if (next !== undefined && Object.hasOwn(controls, next)) { parts.push({ byte: controls[next]! }); index++; }
      else if (next !== undefined && next >= 48 && next <= 55) {
        let value = 0;
        const end = Math.min(source.length, index + 3);
        while (index < end && source[index]! >= 48 && source[index]! <= 55) {
          await budget.step();
          value = value * 8 + source[index++]! - 48;
        }
        parts.push({ byte: value & 255 });
      } else throw new UsageError("unsupported printf format escape");
    }
    literal = index;
  }
  if (literal < source.length && index > literal) parts.push({ start: literal, end: index });
  return async entry => {
    for (const part of parts) {
      await budget.step();
      if ("directive" in part) await budget.text(await field(entry, part.directive, budget));
      else if ("byte" in part) { budget.admitOutput(1); await budget.write(Uint8Array.of(part.byte)); }
      else await budget.write(source.subarray(part.start, part.end));
    }
  };
}
