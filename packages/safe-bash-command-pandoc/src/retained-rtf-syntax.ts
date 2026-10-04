import {PagedStorage} from "safe-bash-io-engine/storage";
import {hexDigit, rtfError} from "./rtf-syntax.js";
import type {ExecutionContext} from "./execution.js";
import type {InputSource, WorkingStorageOptions} from "./types.js";

type Token = {offset: number} & (
  | {kind: "group"}
  | {kind: "word"; name: string; parameter: number | undefined}
  | {kind: "symbol"; name: string}
  | {kind: "hex"; byte: number}
  | {kind: "text"}
  | {kind: "binary"; length: number}
);
const kinds = ["group", "word", "symbol", "hex", "text", "binary"] as const;
const letter = (byte: number) => byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122;
const digit = (byte: number) => byte >= 48 && byte <= 57;

/** Caller-backed source spans and token links. Group parents replace a resident
 * parser stack; payloads are replayed in bounded chunks, never copied into tokens.
 * The retained reader uses this tape for public output conversions. */
export class RetainedRtfSyntax {
  root = 0;
  private readonly source: PagedStorage;
  private readonly tape: PagedStorage;
  private readonly release: () => void;
  private closing: Promise<void> | undefined;
  private start = 0;
  private length = 0;
  private constructor(private readonly context: ExecutionContext, working: WorkingStorageOptions) {
    const owner = {fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal};
    const pages = (working.cacheBytes ?? 1048576) / 16384;
    this.source = new PagedStorage(owner, pages); this.tape = new PagedStorage(owner, pages);
    this.release = context.onClose(() => this.close());
  }
  static async acquire(input: InputSource, context: ExecutionContext, working: WorkingStorageOptions, onInputAcquired?: () => void): Promise<RetainedRtfSyntax> {
    const bytes = working.cacheBytes ?? 1048576;
    if (!Number.isSafeInteger(bytes) || bytes < 16384 || bytes % 16384) context.fail("E_OPTION", "Working storage cacheBytes must be a positive multiple of 16384");
    if (typeof working.directory !== "string" || !working.directory.startsWith("/")) context.fail("E_OPTION", "Working storage requires an absolute caller filesystem directory");
    const result = new RetainedRtfSyntax(context, working);
    try {
      await context.call(async () => {
        result.start = result.source.allocate(0);
        await context.consume("bytes" in input ? [input.bytes] : input.chunks, async chunk => {
          if (Number.isFinite(context.limits.references) || Number.isFinite(context.limits.retainedBytes)) {
            const blocks = Math.ceil((result.length + chunk.length) / 4096) - Math.ceil(result.length / 4096);
            for (let index = 0; index < blocks; index++) {
              context.charge("retainedBytes", Math.min(4096, context.limits.inputBytes - (Math.ceil(result.length / 4096) + index) * 4096));
              context.charge("references", 1);
            }
          }
          await result.source.append(chunk); result.length += chunk.length;
        }, ["inputBytes"]);
        context.charge("retainedBytes", result.length);
        onInputAcquired?.();
        await result.parse();
      });
      return result;
    } catch (error) {try {await result.close();} catch { /* Preserve source or syntax failure. */ } throw error;}
  }
  close(): Promise<void> {
    this.closing ??= (async () => {
      let failure: {reason: unknown} | undefined;
      try {await this.source.close();} catch (reason) {failure = {reason};}
      try {await this.tape.close();} catch (reason) {failure ??= {reason};}
      finally {this.release();}
      if (failure) throw failure.reason;
    })();
    return this.closing;
  }
  // kind, input offset, payload offset, payload length, parameter, parent,
  // first child, last child, next sibling. All records have fixed size.
  private async fields(node: number): Promise<number[]> {
    const bytes = await this.tape.read(node, 72), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return Array.from({length: 9}, (_, index) => view.getFloat64(index * 8, true));
  }
  private async put(node: number, fields: readonly number[]): Promise<void> {
    const bytes = new Uint8Array(fields.length * 8), view = new DataView(bytes.buffer);
    fields.forEach((value, index) => view.setFloat64(index * 8, value, true)); await this.tape.write(node, bytes);
  }
  async token(node: number): Promise<Token> {
    await this.context.cooperate();
    const fields = await this.fields(node), kind = kinds[fields[0]!]!, offset = fields[1]!;
    if (kind === "binary") return {kind, offset, length: fields[3]!};
    if (kind === "group" || kind === "text") return {kind, offset};
    if (kind === "hex") return {kind, offset, byte: fields[4]!};
    const bytes = await this.source.read(this.start + fields[2]!, fields[3]!);
    let name = ""; for (const byte of bytes) name += String.fromCharCode(byte);
    if (kind === "symbol") return {kind, offset, name};
    return {kind, offset, name, parameter: Number.isNaN(fields[4]!) ? undefined : fields[4]!};
  }
  async first(node: number): Promise<number> {return (await this.fields(node))[6]!;}
  async next(node: number): Promise<number> {return (await this.fields(node))[8]!;}
  async *children(node: number): AsyncGenerator<number> {
    let child = (await this.fields(node))[6]!;
    while (child) {await this.context.cooperate(); yield child; child = (await this.fields(child))[8]!;}
  }
  async *chunks(node: number): AsyncGenerator<Uint8Array> {
    const fields = await this.fields(node), length = fields[3]!;
    for (let offset = 0; offset < length; offset += 16384) {
      await this.context.cooperate();
      yield await this.source.read(this.start + fields[2]! + offset, Math.min(16384, length - offset));
    }
  }
  private async parse(): Promise<void> {
    const context = this.context, sentinel = this.tape.allocate(72);
    await this.put(sentinel, [0, -1, 0, 0, NaN, 0, 0, 0, 0]);
    let group = sentinel, depth = 0, roots = 0, cursor = 0;
    let windowStart = -1;
    let window: Uint8Array = new Uint8Array(0);
    const at = async (position: number): Promise<number> => {
      if (position >= this.length) return -1;
      if (position < windowStart || position >= windowStart + window.length) {
        windowStart = Math.floor(position / 16384) * 16384;
        window = await this.source.read(this.start + windowStart, Math.min(16384, this.length - windowStart));
      }
      return window[position - windowStart]!;
    };
    const add = async (kind: typeof kinds[number], offset: number, start = 0, length = 0, parameter = NaN): Promise<number> => {
      context.charge("references", 1); context.charge("retainedBytes", 64);
      const node = this.tape.allocate(72), parent = await this.fields(group);
      await this.put(node, [kinds.indexOf(kind), offset, start, length, parameter, group, 0, 0, 0]);
      if (parent[7]) await this.put(parent[7]! + 64, [node]); else await this.put(group + 48, [node]);
      await this.put(group + 56, [node]);
      if (group === sentinel) roots++;
      return node;
    };
    while (cursor < this.length) {
      await context.cooperate();
      const offset = cursor, byte = await at(cursor++);
      if (byte === 13 || byte === 10) continue;
      if (byte === 123) {context.bound("depth", ++depth); group = await add("group", offset); continue;}
      if (byte === 125) {
        if (group === sentinel) rtfError(context, "Unmatched RTF closing brace", "E_PARSE", offset);
        group = (await this.fields(group))[5]!; depth--; continue;
      }
      if (byte !== 92) {
        while (cursor < this.length && ![10, 13, 92, 123, 125].includes(await at(cursor))) {
          context.checkpoint(); cursor++; if (cursor % 256 === 0) await context.cooperate(0);
        }
        await add("text", offset, offset, cursor - offset); continue;
      }
      if (cursor === this.length) rtfError(context, "Truncated RTF control", "E_PARSE", offset);
      const start = cursor, control = await at(cursor++);
      if (control === 39) {
        const high = hexDigit(await at(cursor++)), low = hexDigit(await at(cursor++));
        if (high < 0 || low < 0) rtfError(context, "Malformed RTF hex escape", "E_PARSE", offset);
        await add("hex", offset, 0, 0, high * 16 + low); continue;
      }
      if (!letter(control)) {await add("symbol", offset, start, 1); continue;}
      let name = String.fromCharCode(control);
      while (letter(await at(cursor))) {
        context.checkpoint();
        if (name.length >= 32) rtfError(context, "RTF control word exceeds 32 letters", "E_PARSE", offset);
        name += String.fromCharCode(await at(cursor++));
      }
      let parameter: number | undefined;
      const negative = await at(cursor) === 45;
      if (negative) cursor++;
      if (digit(await at(cursor))) {
        let value = 0;
        while (digit(await at(cursor))) {
          context.checkpoint(); value = value * 10 + await at(cursor++) - 48;
          if (value > (negative ? 2147483648 : 2147483647)) rtfError(context, "RTF parameter out of range", "E_PARSE", offset);
        }
        parameter = negative ? -value : value;
      } else if (negative) rtfError(context, "Missing signed RTF parameter", "E_PARSE", offset);
      if (await at(cursor) === 32) cursor++;
      if (name === "bin") {
        if (parameter === undefined || parameter < 0 || parameter > this.length - cursor) rtfError(context, "Invalid or truncated RTF binary count", "E_PARSE", offset);
        context.charge("binaryBytes", parameter); context.checkpoint(Math.max(1, Math.ceil(parameter / 256)));
        await add("binary", offset, cursor, parameter); cursor += parameter;
      } else await add("word", offset, start, name.length, parameter);
    }
    if (group !== sentinel) rtfError(context, "Unclosed RTF group", "E_PARSE", (await this.fields(group))[1]!);
    const root = (await this.fields(sentinel))[6]!;
    if (roots !== 1 || (await this.token(root)).kind !== "group") rtfError(context, "RTF requires one root group");
    const child = (await this.fields(root))[6]!, header = child ? await this.token(child) : undefined;
    if (header?.kind !== "word" || header.name !== "rtf") rtfError(context, "Missing RTF document header");
    if (header.parameter !== 1) rtfError(context, "Only the declared RTF 1.9.1 subset is supported", "E_CAPABILITY");
    this.root = root;
  }
}
