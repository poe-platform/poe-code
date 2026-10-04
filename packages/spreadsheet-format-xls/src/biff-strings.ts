import { SsconvertError } from "@poe-code/spreadsheet-engine/contracts";
import { singleByteTables } from "@poe-code/spreadsheet-engine/encoding/tables";
import { biffDbcsTables } from "@poe-code/spreadsheet-engine/encoding/biff-dbcs-tables";
import { Binary, invalidBiff, type BiffReadContext } from "./biff-binary.js";
import type { RichTextRun } from "@poe-code/spreadsheet-ast";

// Native gnm_xl_get_codepage accepts these exact spellings, not iconv's alias set.
const overrideCodepages: Readonly<Record<string, number>> = {
  "windows-1250": 1250, "windows-1251": 1251, "windows-1252": 1252,
  "windows-1254": 1254, "windows-1255": 1255, "windows-1256": 1256, "windows-1257": 1257,
  "windows-1258": 1258, "windows-936": 936
};
export function biffOverrideCodepage(encoding: string | undefined): number | undefined {
  return encoding === undefined ? undefined : overrideCodepages[encoding];
}
export function biffDecode(bytes: Uint8Array, codepage: number): string {
  if (codepage === 65001) return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const multibyte = biffDbcsTables[codepage];
  if (multibyte) {
    const characters: string[] = [];
    for (let i = 0; i < bytes.length; i++) {
      const lead = bytes[i]!, single = multibyte.single[lead]!;
      if (single !== "\uffff") { characters.push(single); continue; }
      const trail = bytes[++i], character = trail === undefined ? undefined : multibyte.double[lead]?.[trail];
      if (character === undefined || character === "\uffff") invalidBiff("invalid or truncated DBCS character");
      characters.push(character);
    }
    return characters.join("");
  }
  const name = codepage === 20127 ? "ascii" : codepage === 1200 || codepage === 1201 || codepage === 28591 ? "iso-8859-1" :
    codepage === 10000 ? "macintosh" : codepage >= 1250 && codepage <= 1258 ? `windows-${codepage}` : `cp${codepage}`;
  const table = singleByteTables[name];
  if (!table) throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: BIFF codepage ${codepage}`);
  const characters: string[] = [];
  for (const byte of bytes) {
    const character = table[byte]!;
    if (character === "\uffff") invalidBiff("invalid codepage character");
    characters.push(character);
  }
  return characters.join("");
}

type StringValue = { text: string; richText?: readonly RichTextRun[] };
type StringSteps<T> = Generator<void, T, Binary | undefined>;

/** One active payload; yield only when the next CONTINUE record is needed. */
class StringDecoder {
  private data: Binary | undefined;
  private offset = 0;
  private previousBytes = 0;
  constructor(private readonly context: BiffReadContext, private readonly codepage: number) {}
  get consumedBytes(): number { return this.previousBytes + this.offset; }
  private *advance(): StringSteps<void> {
    if (!this.data) this.data = yield;
    while (this.data && this.offset === this.data.bytes.length) {
      this.context.signal.throwIfAborted(); this.context.work?.();
      this.previousBytes += this.data.bytes.length; this.offset = 0;
      this.data = undefined; this.data = yield;
    }
    if (!this.data) invalidBiff("truncated string/CONTINUE");
  }
  *byte(): StringSteps<number> {
    this.context.signal.throwIfAborted(); this.context.work?.();
    yield* this.advance(); return this.data!.u8(this.offset++);
  }
  *word(): StringSteps<number> { const low = yield* this.byte(); return low + (yield* this.byte()) * 256; }
  *dword(): StringSteps<number> { const low = yield* this.word(); return low + (yield* this.word()) * 65536; }
  *legacy(length: number): StringSteps<string> {
    this.admit(length);
    const bytes = new Uint8Array(length); for (let i = 0; i < length; i++) bytes[i] = yield* this.byte();
    return biffDecode(bytes, this.codepage);
  }
  private admit(length: number): void {
    this.context.signal.throwIfAborted();
    if (length > (this.context.limits.workbookTextBytes ?? this.context.limits.inputBytes))
      throw new SsconvertError("resource-limit", "ssconvert BIFF string limit exceeded");
    this.context.retain?.(length * 16);
  }
  *unicode(length: number): StringSteps<StringValue> {
    this.admit(length * 3);
    const flags = yield* this.byte();
    if (flags & 0xf2) invalidBiff("invalid Unicode string flags");
    let wide = !!(flags & 1);
    const runCount = flags & 8 ? yield* this.word() : 0, extensionLength = flags & 4 ? yield* this.dword() : 0;
    this.admit(runCount * 4 + extensionLength);
    const characters: string[] = [];
    for (let i = 0; i < length; i++) {
      this.context.signal.throwIfAborted(); this.context.work?.();
      if (this.offset === this.data!.bytes.length) {
        yield* this.advance(); const width = yield* this.byte(); if (width > 1) invalidBiff("invalid CONTINUE string width"); wide = !!width;
      }
      const data = this.data!;
      data.check(this.offset, wide ? 2 : 1);
      characters.push(String.fromCharCode(wide ? data.u16(this.offset) : data.u8(this.offset)));
      this.offset += wide ? 2 : 1;
    }
    const runs: { start: number; font: number }[] = [];
    for (let i = 0; i < runCount; i++) {
      const start = yield* this.word(), font = yield* this.word();
      if (start > length || i && start < runs[i - 1]!.start) invalidBiff("invalid rich string run");
      runs.push({ start, font });
    }
    for (let i = 0; i < extensionLength; i++) yield* this.byte();
    return { text: characters.join(""), ...(runs.length ? { richText: runs.map((run, index) => ({ start: run.start,
      end: runs[index + 1]?.start ?? length, attributes: { "biff-font-index": run.font } })) } : {}) };
  }
  *shared(): StringSteps<StringValue> { return yield* this.unicode(yield* this.word()); }
}

/** Buffered convenience shares the decoder with retained record ingestion. */
export class BiffStrings {
  private readonly decoder: StringDecoder;
  private part = 0;
  constructor(private readonly parts: readonly Binary[], context: BiffReadContext, codepage: number) {
    this.decoder = new StringDecoder(context, codepage);
  }
  get consumedBytes(): number { return this.decoder.consumedBytes; }
  private run<T>(steps: StringSteps<T>): T {
    let next = steps.next();
    while (!next.done) next = steps.next(this.parts[this.part++]);
    return next.value;
  }
  byte(): number { return this.run(this.decoder.byte()); }
  word(): number { return this.run(this.decoder.word()); }
  dword(): number { return this.run(this.decoder.dword()); }
  legacy(length: number): string { return this.run(this.decoder.legacy(length)); }
  unicode(length: number): StringValue { return this.run(this.decoder.unicode(length)); }
}

/** Borrowed record lookup is lazy; the caller retains ownership of its backing store. */
export class BiffStringSource {
  private readonly decoder: StringDecoder;
  constructor(private readonly nextPart: () => Promise<Binary | undefined>, private readonly context: BiffReadContext, codepage: number) {
    this.decoder = new StringDecoder(context, codepage);
  }
  private async run<T>(steps: StringSteps<T>): Promise<T> {
    this.context.signal.throwIfAborted();
    let next = steps.next();
    while (!next.done) {
      this.context.signal.throwIfAborted();
      const part = await this.nextPart();
      this.context.signal.throwIfAborted();
      next = steps.next(part);
    }
    return next.value;
  }
  word(): Promise<number> { return this.run(this.decoder.word()); }
  legacy(length: number): Promise<string> { return this.run(this.decoder.legacy(length)); }
  unicode(length: number): Promise<StringValue> { return this.run(this.decoder.unicode(length)); }
}

/** Shared strings can span many records, but need only one input payload at a time. */
export async function* readBiffStrings(parts: AsyncIterable<Binary>, count: number, context: BiffReadContext,
  codepage: number): AsyncGenerator<StringValue, void> {
  context.signal.throwIfAborted();
  const decoder = new StringDecoder(context, codepage), iterator = parts[Symbol.asyncIterator]();
  let failed = false, failure: unknown;
  const close = async () => {
    try { await iterator.return?.(); }
    catch (cleanup) {
      if (failed) throw new AggregateError([failure, cleanup], "BIFF string input and cleanup failed");
      throw cleanup;
    }
  };
  try {
    for (let index = 0; index < count; index++) {
      context.signal.throwIfAborted();
      const steps = decoder.shared(); let next = steps.next();
      while (!next.done) {
        context.signal.throwIfAborted(); const part = await iterator.next(); context.signal.throwIfAborted();
        next = steps.next(part.done ? undefined : part.value);
      }
      yield next.value;
    }
  } catch (error) { failed = true; failure = error; throw error; }
  finally { await close(); }
}
