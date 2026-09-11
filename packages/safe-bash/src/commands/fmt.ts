import { FsError, getCommandArguments, isFsError, writeBytes, type ByteSource, type CommandContext, type CommandDefinition, type FileSystemCapabilities } from "../contracts/index.js";
import { assertCommandRequirements } from "../contracts/command-requirements.js";
import { yieldTurn } from "../contracts/yield.js";
import { PublicDiagnostic } from "../diagnostics.js";
import { ByteInputBudget } from "./bytes/input-budget.js";
import { bufferLimit, diagnostic, output, pathOf } from "./internal.js";
import { inputRequirements } from "./portable-requirements.js";

interface Settings {
  width: number;
  goal: number;
  crown: boolean;
  tagged: boolean;
  split: boolean;
  uniform: boolean;
  prefix: Uint8Array;
  leading: number;
  fullPrefix: number;
  files: { name: string; bytes: Uint8Array }[];
  information?: string;
}

class OptionDiagnostic extends Error {
  constructor(readonly bytes: Uint8Array) { super("invalid fmt option"); }
}

function optionError(message: string): never {
  throw new OptionDiagnostic(Uint8Array.from(`fmt: ${message}\nTry 'fmt --help' for more information.\n`, unit => unit.charCodeAt(0)));
}

function widthValue(text: string, maximum: number, unicode: boolean): number {
  let offset = 0;
  while (text.charCodeAt(offset) === 32 || text.charCodeAt(offset) >= 9 && text.charCodeAt(offset) <= 13) offset++;
  if (text[offset] === "+") offset++;
  const start = offset;
  let number = 0;
  while (text.charCodeAt(offset) >= 48 && text.charCodeAt(offset) <= 57) {
    number = Math.min(1073741824, number * 10 + text.charCodeAt(offset++) - 48);
  }
  if (offset === start || offset !== text.length || number > maximum) {
    const range = offset === text.length && offset !== start && number > maximum;
    throw new PublicDiagnostic(`invalid width: ${quote(Uint8Array.from(text, unit => unit.charCodeAt(0)), false, unicode)}${range ? number > 1073741823 ? ": Value too large for defined data type" : ": Numerical result out of range" : ""}`);
  }
  return number;
}

function parse(context: CommandContext): Settings {
  const settings: Settings = { width: 75, goal: 70, crown: false, tagged: false, split: false, uniform: false, prefix: new Uint8Array(), leading: 0, fullPrefix: 0, files: [] };
  let width: string | undefined;
  let goal: string | undefined;
  let stopped = false;
  const long: Readonly<Record<string, string>> = { "crown-margin": "c", prefix: "p", "split-only": "s", "tagged-paragraph": "t", "uniform-spacing": "u", width: "w", goal: "g", help: "help", version: "version" };
  let size = 0;
  for (const argument of context.args) {
    size += argument.length;
    if (size > 65536 || context.args.length > 4096) throw new PublicDiagnostic("argument limit exceeded");
  }
  const argumentsWithBytes = getCommandArguments(context);
  size = 0;
  const args = context.args.map((_argument, position) => {
    const bytes = argumentsWithBytes.bytes(position)!;
    size += bytes.length;
    if (size > 65536) throw new PublicDiagnostic("argument limit exceeded");
    return Array.from(bytes, byte => String.fromCharCode(byte)).join("");
  });
  let index = 0;
  const first = args[0];
  if (first?.startsWith("-") && first.charCodeAt(1) >= 48 && first.charCodeAt(1) <= 57) { width = first.slice(1); index++; }
  for (; index < args.length; index++) {
    const argument = args[index]!;
    if (stopped || !argument.startsWith("-") || argument === "-") {
      settings.files.push({ name: context.args[index]!, bytes: argumentsWithBytes.bytes(index)! });
      if (context.env.POSIXLY_CORRECT !== undefined) stopped = true;
      continue;
    }
    if (argument === "--") { stopped = true; continue; }
    const expanded: { key: string; value?: string; position: number; valueOffset: number }[] = [];
    if (argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const name = argument.slice(2, equals < 0 ? undefined : equals);
      const matches = Object.keys(long).filter(key => key.startsWith(name));
      const selected = Object.hasOwn(long, name) ? name : matches.length === 1 ? matches[0] : undefined;
      if (!selected) {
        if (matches.length > 1) optionError(`option '${argument}' is ambiguous; possibilities: ${matches.map(key => `'--${key}'`).join(" ")}`);
        optionError(`unrecognized option '${argument}'`);
      }
      const key = long[selected]!;
      let value: string | undefined;
      let position = index;
      if ("pwg".includes(key)) {
        value = equals < 0 ? args[++index] : argument.slice(equals + 1);
        position = index;
        if (value === undefined) optionError(`option '--${selected}' requires an argument`);
      } else if (equals >= 0) optionError(`option '--${selected}' doesn't allow an argument`);
      expanded.push({ key, ...(value === undefined ? {} : { value }), position, valueOffset: equals < 0 ? 0 : equals + 1 });
    } else {
      for (let offset = 1; offset < argument.length; offset++) {
        const key = argument[offset]!;
        if (key >= "0" && key <= "9") optionError(`invalid option -- ${key}; -WIDTH is recognized only when it is the first\noption; use -w N instead`);
        if (!"cstuwpg".includes(key)) optionError(`invalid option -- '${key}'`);
        let value: string | undefined;
        let valueOffset = 0;
        if ("pwg".includes(key)) {
          if (offset + 1 < argument.length) valueOffset = offset + 1;
          value = argument.slice(offset + 1) || args[++index];
          if (value === undefined) optionError(`option requires an argument -- '${key}'`);
          offset = argument.length;
        }
        expanded.push({ key, ...(value === undefined ? {} : { value }), position: index, valueOffset });
      }
    }
    for (const option of expanded) {
      switch (option.key) {
        case "c": settings.crown = true; break;
        case "t": settings.tagged = true; break;
        case "s": settings.split = true; break;
        case "u": settings.uniform = true; break;
        case "w": width = option.value!; break;
        case "g": goal = option.value!; break;
        case "help": case "version": settings.information = option.key; return settings;
        case "p": {
          const bytes = argumentsWithBytes.bytes(option.position)!.subarray(option.valueOffset);
          let start = 0;
          let end = bytes.indexOf(0);
          if (end < 0) end = bytes.length;
          while (start < end && bytes[start] === 32) start++;
          settings.leading = start;
          settings.fullPrefix = end - start;
          while (end > start && bytes[end - 1] === 32) end--;
          settings.prefix = new Uint8Array(bytes.subarray(start, end));
          break;
        }
      }
    }
  }
  const unicode = unicodeLocale(context);
  if (width !== undefined) settings.width = widthValue(width, 2500, unicode);
  if (goal !== undefined) {
    settings.goal = widthValue(goal, settings.width, unicode);
    if (width === undefined) settings.width = settings.goal + 10;
  } else settings.goal = Math.trunc(settings.width * 187 / 200);
  if (!settings.files.length) settings.files.push({ name: "-", bytes: Uint8Array.of(45) });
  return settings;
}

interface Word {
  start: number;
  length: number;
  space: number;
  opening: boolean;
  period: boolean;
  punctuation: boolean;
  final: boolean;
}

type Formatting<Result = void> = Generator<Uint8Array | "input" | undefined, Result, Uint8Array | null | undefined>;

class WorkBudget {
  operations = 0;
  output = 0;
  *step(): Formatting {
    if (++this.operations > 128 * 1024 * 1024) throw new PublicDiagnostic("work limit exceeded");
    if (this.operations % 4096 === 0) yield undefined;
  }
}

class Formatter {
  private chunk: Uint8Array = new Uint8Array();
  private offset = 0;
  private eof = false;
  private pending: number[] = [];
  private text = new Uint8Array(5000);
  private used = 0;
  private words: Word[] = [];
  private costs: number[] = [];
  private breaks: number[] = [];
  private lengths: number[] = [];
  private column = 0;
  private nextPrefix = 0;
  private prefixIndent = 0;
  private firstIndent = 0;
  private otherIndent = 0;
  private lastLength = 0;
  private outColumn = 0;
  private tabs = false;

  constructor(private settings: Settings, private budget: WorkBudget) {}

  private *read(): Formatting<number> {
    yield* this.budget.step();
    while (this.offset === this.chunk.length) {
      if (this.eof) return -1;
      const incoming = yield "input";
      if (incoming === null) { this.eof = true; return -1; }
      this.chunk = incoming!;
      this.offset = 0;
    }
    return this.chunk[this.offset++]!;
  }

  private *emit(byte: number): Formatting {
    if (++this.budget.output > bufferLimit) throw new PublicDiagnostic("output limit exceeded");
    this.pending.push(byte);
    if (this.pending.length === 16384) { yield Uint8Array.from(this.pending); this.pending = []; }
  }

  private *spaces(count: number): Formatting {
    const target = this.outColumn + count;
    const tabEnd = Math.trunc(target / 8) * 8;
    if (this.tabs && this.outColumn + 1 < tabEnd) {
      while (this.outColumn < tabEnd) {
        yield* this.emit(9);
        this.outColumn = (Math.trunc(this.outColumn / 8) + 1) * 8;
      }
    }
    while (this.outColumn < target) { yield* this.emit(32); this.outColumn++; }
  }

  private *whitespace(byte: number): Formatting<number> {
    while (byte === 32 || byte === 9) {
      if (byte === 32) this.column++;
      else { this.tabs = true; this.column = (Math.trunc(this.column / 8) + 1) * 8; }
      byte = yield* this.read();
    }
    return byte;
  }

  private *lineStart(): Formatting<number> {
    this.column = 0;
    let byte = yield* this.whitespace(yield* this.read());
    const { prefix, leading } = this.settings;
    this.nextPrefix = prefix.length ? this.column : Math.min(leading, this.column);
    if (prefix.length) {
      for (const expected of prefix) {
        if (byte !== expected) return byte;
        this.column++;
        byte = yield* this.read();
      }
      byte = yield* this.whitespace(byte);
    }
    return byte;
  }

  private compatible(byte: number): boolean {
    return byte !== -1 && byte !== 10 && this.nextPrefix === this.prefixIndent && this.column >= this.nextPrefix + this.settings.fullPrefix;
  }

  private secondary(compatible: boolean): void {
    if (this.settings.split) this.otherIndent = this.firstIndent;
    else if (this.settings.crown) this.otherIndent = compatible ? this.column : this.firstIndent;
    else if (this.settings.tagged) {
      if (compatible && this.column !== this.firstIndent) this.otherIndent = this.column;
      else if (this.otherIndent === this.firstIndent) this.otherIndent = this.firstIndent === 0 ? 3 : 0;
    } else this.otherIndent = this.firstIndent;
  }

  private *optimize(): Formatting {
    const count = this.words.length;
    this.costs[count] = 0;
    for (let start = count - 1; start >= 0; start--) {
      const word = this.words[start]!;
      let penalty = 4900;
      const previous = this.words[start - 1];
      if (previous?.period) penalty += previous.final ? -2500 : 360000;
      else if (previous?.punctuation) penalty -= 1600;
      else if (previous && this.words[start - 2]?.final) penalty += Math.trunc(40000 / (previous.length + 2));
      if (word.opening) penalty -= 1600;
      else if (word.final) penalty += Math.trunc(22500 / (word.length + 2));
      let length = (start === 0 ? this.firstIndent : this.otherIndent) + word.length;
      let best = Infinity;
      for (let end = start + 1; ; end++) {
        yield* this.budget.step();
        let cost = this.costs[end]!;
        if (end !== count) {
          cost += 100 * (this.settings.goal - length) ** 2;
          if (this.breaks[end] !== count) cost += 50 * (length - this.lengths[end]!) ** 2;
        }
        if (start === 0 && this.lastLength > 0) cost += 50 * (length - this.lastLength) ** 2;
        if (cost < best) { best = cost; this.breaks[start] = end; this.lengths[start] = length; }
        if (end === count) break;
        length += this.words[end - 1]!.space + this.words[end]!.length;
        if (length >= this.settings.width) break;
      }
      this.costs[start] = best + penalty;
    }
  }

  private *render(finish: number): Formatting {
    for (let start = 0; start < finish; start = this.breaks[start]!) {
      this.outColumn = 0;
      yield* this.spaces(this.prefixIndent);
      for (const byte of this.settings.prefix) yield* this.emit(byte);
      this.outColumn += this.settings.prefix.length;
      yield* this.spaces((start === 0 ? this.firstIndent : this.otherIndent) - this.outColumn);
      const end = this.breaks[start]!;
      for (let index = start; index < end; index++) {
        const word = this.words[index]!;
        for (let position = word.start; position < word.start + word.length; position++) yield* this.emit(this.text[position]!);
        this.outColumn += word.length;
        if (index + 1 !== end) yield* this.spaces(word.space);
      }
      this.lastLength = this.outColumn;
      yield* this.emit(10);
    }
  }

  private *makeRoom(current: Word): Formatting {
    this.secondary(true);
    if (!this.words.length) {
      for (let position = 0; position < this.used; position++) yield* this.emit(this.text[position]!);
      this.used = 0;
      current.start = 0;
      return;
    }
    yield* this.optimize();
    let cut = this.words.length;
    let score = Infinity;
    for (let line = this.breaks[0]!; line !== this.words.length; line = this.breaks[line]!) {
      const candidate = this.costs[line]! - this.costs[this.breaks[line]!]!;
      if (candidate < score) { cut = line; score = candidate; }
      score += 9;
    }
    yield* this.render(cut);
    const offset = cut === this.words.length ? current.start : this.words[cut]!.start;
    this.text.copyWithin(0, offset, this.used);
    this.used -= offset;
    this.words = this.words.slice(cut);
    for (const word of this.words) word.start -= offset;
    current.start -= offset;
  }

  private *readLine(byte: number): Formatting<number> {
    do {
      const word: Word = { start: this.used, length: 0, space: 0, opening: false, period: false, punctuation: false, final: false };
      do {
        if (this.used === this.text.length) yield* this.makeRoom(word);
        this.text[this.used++] = byte;
        byte = yield* this.read();
      } while (byte !== -1 && byte !== 32 && !(byte >= 9 && byte <= 13));
      word.length = this.used - word.start;
      this.column += word.length;
      const first = this.text[word.start]!;
      const last = this.text[this.used - 1]!;
      word.opening = first === 0 || "(['`\"".includes(String.fromCharCode(first));
      word.punctuation = last >= 33 && last <= 47 || last >= 58 && last <= 64 || last >= 91 && last <= 96 || last >= 123 && last <= 126;
      let terminal = this.used - 1;
      while (terminal > word.start && (this.text[terminal] === 0 || ")]'\"".includes(String.fromCharCode(this.text[terminal]!)))) terminal--;
      word.period = this.text[terminal] === 0 || ".?!".includes(String.fromCharCode(this.text[terminal]!));
      const before = this.column;
      byte = yield* this.whitespace(byte);
      word.space = this.column - before;
      word.final = byte === -1 || word.period && (byte === 10 || word.space > 1);
      if (byte === 10 || byte === -1 || this.settings.uniform) word.space = word.final ? 2 : 1;
      if (this.words.length === 998) yield* this.makeRoom(word);
      this.words.push(word);
    } while (byte !== -1 && byte !== 10);
    return yield* this.lineStart();
  }

  *run(): Formatting {
    let byte = yield* this.lineStart();
    while (true) {
      if (byte === 10 || byte === -1 || this.nextPrefix < this.settings.leading || this.column < this.nextPrefix + this.settings.fullPrefix) {
        this.outColumn = 0;
        if (this.column > this.nextPrefix || byte !== 10 && byte !== -1) {
          yield* this.spaces(this.nextPrefix);
          for (const prefixByte of this.settings.prefix) {
            if (this.outColumn === this.column) break;
            yield* this.emit(prefixByte);
            this.outColumn++;
          }
          if (byte !== -1 && byte !== 10) yield* this.spaces(this.column - this.outColumn);
          if (byte === -1 && this.column >= this.nextPrefix + this.settings.prefix.length) yield* this.emit(10);
        }
        while (byte !== -1 && byte !== 10) { yield* this.emit(byte); byte = yield* this.read(); }
        if (byte === -1) break;
        yield* this.emit(10);
        byte = yield* this.lineStart();
        continue;
      }
      this.lastLength = 0;
      this.prefixIndent = this.nextPrefix;
      this.firstIndent = this.column;
      this.words = [];
      this.used = 0;
      byte = yield* this.readLine(byte);
      this.secondary(this.compatible(byte));
      if (!this.settings.split) {
        const acceptSecond = this.compatible(byte) && (this.settings.crown || this.settings.tagged ? this.settings.crown || this.column !== this.firstIndent : this.column === this.otherIndent);
        if (acceptSecond) {
          do { byte = yield* this.readLine(byte); } while (this.compatible(byte) && this.column === this.otherIndent);
        }
      }
      const last = this.words[this.words.length - 1]!;
      last.period = true;
      last.final = true;
      yield* this.optimize();
      yield* this.render(this.words.length);
    }
    if (this.pending.length) { yield Uint8Array.from(this.pending); this.pending = []; }
  }
}

class InputScope {
  private iterator: AsyncIterator<Uint8Array> | undefined;
  private reader: AsyncIterator<Uint8Array> | undefined;
  private finished = false;
  private retirement: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private acquisition: Promise<void> | undefined;

  constructor(private context: CommandContext, private budget: ByteInputBudget) {}

  async open(name: string, bytes: Uint8Array): Promise<void> {
    const { context } = this;
    context.signal.throwIfAborted();
    let file: { path: string; capabilities: FileSystemCapabilities } | undefined;
    if (name !== "-") {
      const encoded = new TextEncoder().encode(name);
      if (encoded.length !== bytes.length || encoded.some((byte, index) => byte !== bytes[index])) throw new FsError("ENOENT", { path: name });
      const path = pathOf(context, name);
      const capabilities = await context.fs.capabilitiesFor?.(path, { signal: context.signal }) ?? context.fs.capabilities;
      context.signal.throwIfAborted();
      file = { path, capabilities };
    }
    this.acquisition = Promise.resolve().then(() => {
      context.signal.throwIfAborted();
      let source: ByteSource = context.stdin;
      if (file) {
        const { path, capabilities } = file;
        assertCommandRequirements(context, inputRequirements, ["file"], capabilities);
        if (context.fs.readStream && capabilities.streamingRead !== false) source = context.fs.readStream(path, { signal: context.signal, chunkSize: 65536 });
        else {
          if (capabilities.read === false) throw new FsError("ENOTSUP", { path, syscall: "readFile" });
          source = { async *[Symbol.asyncIterator]() { yield await context.fs.readFile(path, { signal: context.signal, maxBytes: bufferLimit }); } };
        }
      }
      context.signal.throwIfAborted();
      this.iterator = source[Symbol.asyncIterator]();
      this.reader = this.budget.read({ [Symbol.asyncIterator]: () => ({
        next: async () => {
          const item = await this.iterator!.next();
          if (item.done) this.finished = true;
          return item;
        },
        return: async () => { await this.retire(); return { done: true, value: undefined }; },
      }) }, context.signal)[Symbol.asyncIterator]();
    });
    return this.acquisition;
  }

  async next(): Promise<Uint8Array | null> {
    const item = await this.reader!.next();
    return item.done ? null : new Uint8Array(item.value);
  }

  private retire(): Promise<void> {
    this.retirement ??= Promise.resolve().then(async () => { if (!this.finished) await this.iterator?.return?.(); });
    return this.retirement;
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      await this.acquisition?.catch(() => undefined);
      const results = await Promise.allSettled([this.retire(), this.reader?.return?.()]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
    })();
    return this.closing;
  }
}

const glibc231PrintableRanges = [
  0x20, 0x7e, 0xa0, 0x377, 0x37a, 0x37f, 0x384, 0x38a, 0x38c, 0x38c, 0x38e, 0x3a1, 0x3a3, 0x52f, 0x531, 0x556,
  0x559, 0x55f, 0x561, 0x587, 0x589, 0x58a, 0x58d, 0x58f, 0x591, 0x5c7, 0x5d0, 0x5ea, 0x5f0, 0x5f4, 0x600, 0x61c,
  0x61e, 0x70d, 0x70f, 0x74a, 0x74d, 0x7b1, 0x7c0, 0x7fa, 0x800, 0x82d, 0x830, 0x83e, 0x840, 0x85b, 0x85e, 0x85e,
  0x8a0, 0x8b4, 0x8b6, 0x8bd, 0x8d4, 0x983, 0x985, 0x98c, 0x98f, 0x990, 0x993, 0x9a8, 0x9aa, 0x9b0, 0x9b2, 0x9b2,
  0x9b6, 0x9b9, 0x9bc, 0x9c4, 0x9c7, 0x9c8, 0x9cb, 0x9ce, 0x9d7, 0x9d7, 0x9dc, 0x9dd, 0x9df, 0x9e3, 0x9e6, 0x9fb,
  0xa01, 0xa03, 0xa05, 0xa0a, 0xa0f, 0xa10, 0xa13, 0xa28, 0xa2a, 0xa30, 0xa32, 0xa33, 0xa35, 0xa36, 0xa38, 0xa39,
  0xa3c, 0xa3c, 0xa3e, 0xa42, 0xa47, 0xa48, 0xa4b, 0xa4d, 0xa51, 0xa51, 0xa59, 0xa5c, 0xa5e, 0xa5e, 0xa66, 0xa75,
  0xa81, 0xa83, 0xa85, 0xa8d, 0xa8f, 0xa91, 0xa93, 0xaa8, 0xaaa, 0xab0, 0xab2, 0xab3, 0xab5, 0xab9, 0xabc, 0xac5,
  0xac7, 0xac9, 0xacb, 0xacd, 0xad0, 0xad0, 0xae0, 0xae3, 0xae6, 0xaf1, 0xaf9, 0xaf9, 0xb01, 0xb03, 0xb05, 0xb0c,
  0xb0f, 0xb10, 0xb13, 0xb28, 0xb2a, 0xb30, 0xb32, 0xb33, 0xb35, 0xb39, 0xb3c, 0xb44, 0xb47, 0xb48, 0xb4b, 0xb4d,
  0xb56, 0xb57, 0xb5c, 0xb5d, 0xb5f, 0xb63, 0xb66, 0xb77, 0xb82, 0xb83, 0xb85, 0xb8a, 0xb8e, 0xb90, 0xb92, 0xb95,
  0xb99, 0xb9a, 0xb9c, 0xb9c, 0xb9e, 0xb9f, 0xba3, 0xba4, 0xba8, 0xbaa, 0xbae, 0xbb9, 0xbbe, 0xbc2, 0xbc6, 0xbc8,
  0xbca, 0xbcd, 0xbd0, 0xbd0, 0xbd7, 0xbd7, 0xbe6, 0xbfa, 0xc00, 0xc03, 0xc05, 0xc0c, 0xc0e, 0xc10, 0xc12, 0xc28,
  0xc2a, 0xc39, 0xc3d, 0xc44, 0xc46, 0xc48, 0xc4a, 0xc4d, 0xc55, 0xc56, 0xc58, 0xc5a, 0xc60, 0xc63, 0xc66, 0xc6f,
  0xc78, 0xc83, 0xc85, 0xc8c, 0xc8e, 0xc90, 0xc92, 0xca8, 0xcaa, 0xcb3, 0xcb5, 0xcb9, 0xcbc, 0xcc4, 0xcc6, 0xcc8,
  0xcca, 0xccd, 0xcd5, 0xcd6, 0xcde, 0xcde, 0xce0, 0xce3, 0xce6, 0xcef, 0xcf1, 0xcf2, 0xd01, 0xd03, 0xd05, 0xd0c,
  0xd0e, 0xd10, 0xd12, 0xd3a, 0xd3d, 0xd44, 0xd46, 0xd48, 0xd4a, 0xd4f, 0xd54, 0xd63, 0xd66, 0xd7f, 0xd82, 0xd83,
  0xd85, 0xd96, 0xd9a, 0xdb1, 0xdb3, 0xdbb, 0xdbd, 0xdbd, 0xdc0, 0xdc6, 0xdca, 0xdca, 0xdcf, 0xdd4, 0xdd6, 0xdd6,
  0xdd8, 0xddf, 0xde6, 0xdef, 0xdf2, 0xdf4, 0xe01, 0xe3a, 0xe3f, 0xe5b, 0xe81, 0xe82, 0xe84, 0xe84, 0xe87, 0xe88,
  0xe8a, 0xe8a, 0xe8d, 0xe8d, 0xe94, 0xe97, 0xe99, 0xe9f, 0xea1, 0xea3, 0xea5, 0xea5, 0xea7, 0xea7, 0xeaa, 0xeab,
  0xead, 0xeb9, 0xebb, 0xebd, 0xec0, 0xec4, 0xec6, 0xec6, 0xec8, 0xecd, 0xed0, 0xed9, 0xedc, 0xedf, 0xf00, 0xf47,
  0xf49, 0xf6c, 0xf71, 0xf97, 0xf99, 0xfbc, 0xfbe, 0xfcc, 0xfce, 0xfda, 0x1000, 0x10c5, 0x10c7, 0x10c7, 0x10cd, 0x10cd,
  0x10d0, 0x1248, 0x124a, 0x124d, 0x1250, 0x1256, 0x1258, 0x1258, 0x125a, 0x125d, 0x1260, 0x1288, 0x128a, 0x128d, 0x1290, 0x12b0,
  0x12b2, 0x12b5, 0x12b8, 0x12be, 0x12c0, 0x12c0, 0x12c2, 0x12c5, 0x12c8, 0x12d6, 0x12d8, 0x1310, 0x1312, 0x1315, 0x1318, 0x135a,
  0x135d, 0x137c, 0x1380, 0x1399, 0x13a0, 0x13f5, 0x13f8, 0x13fd, 0x1400, 0x169c, 0x16a0, 0x16f8, 0x1700, 0x170c, 0x170e, 0x1714,
  0x1720, 0x1736, 0x1740, 0x1753, 0x1760, 0x176c, 0x176e, 0x1770, 0x1772, 0x1773, 0x1780, 0x17dd, 0x17e0, 0x17e9, 0x17f0, 0x17f9,
  0x1800, 0x180e, 0x1810, 0x1819, 0x1820, 0x1877, 0x1880, 0x18aa, 0x18b0, 0x18f5, 0x1900, 0x191e, 0x1920, 0x192b, 0x1930, 0x193b,
  0x1940, 0x1940, 0x1944, 0x196d, 0x1970, 0x1974, 0x1980, 0x19ab, 0x19b0, 0x19c9, 0x19d0, 0x19da, 0x19de, 0x1a1b, 0x1a1e, 0x1a5e,
  0x1a60, 0x1a7c, 0x1a7f, 0x1a89, 0x1a90, 0x1a99, 0x1aa0, 0x1aad, 0x1ab0, 0x1abe, 0x1b00, 0x1b4b, 0x1b50, 0x1b7c, 0x1b80, 0x1bf3,
  0x1bfc, 0x1c37, 0x1c3b, 0x1c49, 0x1c4d, 0x1c88, 0x1cc0, 0x1cc7, 0x1cd0, 0x1cf6, 0x1cf8, 0x1cf9, 0x1d00, 0x1df5, 0x1dfb, 0x1f15,
  0x1f18, 0x1f1d, 0x1f20, 0x1f45, 0x1f48, 0x1f4d, 0x1f50, 0x1f57, 0x1f59, 0x1f59, 0x1f5b, 0x1f5b, 0x1f5d, 0x1f5d, 0x1f5f, 0x1f7d,
  0x1f80, 0x1fb4, 0x1fb6, 0x1fc4, 0x1fc6, 0x1fd3, 0x1fd6, 0x1fdb, 0x1fdd, 0x1fef, 0x1ff2, 0x1ff4, 0x1ff6, 0x1ffe, 0x2000, 0x2027,
  0x202a, 0x2064, 0x2066, 0x2071, 0x2074, 0x208e, 0x2090, 0x209c, 0x20a0, 0x20be, 0x20d0, 0x20f0, 0x2100, 0x218b, 0x2190, 0x23fe,
  0x2400, 0x2426, 0x2440, 0x244a, 0x2460, 0x2b73, 0x2b76, 0x2b95, 0x2b98, 0x2bb9, 0x2bbd, 0x2bc8, 0x2bca, 0x2bd1, 0x2bec, 0x2bef,
  0x2c00, 0x2c2e, 0x2c30, 0x2c5e, 0x2c60, 0x2cf3, 0x2cf9, 0x2d25, 0x2d27, 0x2d27, 0x2d2d, 0x2d2d, 0x2d30, 0x2d67, 0x2d6f, 0x2d70,
  0x2d7f, 0x2d96, 0x2da0, 0x2da6, 0x2da8, 0x2dae, 0x2db0, 0x2db6, 0x2db8, 0x2dbe, 0x2dc0, 0x2dc6, 0x2dc8, 0x2dce, 0x2dd0, 0x2dd6,
  0x2dd8, 0x2dde, 0x2de0, 0x2e44, 0x2e80, 0x2e99, 0x2e9b, 0x2ef3, 0x2f00, 0x2fd5, 0x2ff0, 0x2ffb, 0x3000, 0x303f, 0x3041, 0x3096,
  0x3099, 0x30ff, 0x3105, 0x312d, 0x3131, 0x318e, 0x3190, 0x31ba, 0x31c0, 0x31e3, 0x31f0, 0x321e, 0x3220, 0x32fe, 0x3300, 0x4db5,
  0x4dc0, 0x9fd5, 0xa000, 0xa48c, 0xa490, 0xa4c6, 0xa4d0, 0xa62b, 0xa640, 0xa6f7, 0xa700, 0xa7ae, 0xa7b0, 0xa7b7, 0xa7f7, 0xa82b,
  0xa830, 0xa839, 0xa840, 0xa877, 0xa880, 0xa8c5, 0xa8ce, 0xa8d9, 0xa8e0, 0xa8fd, 0xa900, 0xa953, 0xa95f, 0xa97c, 0xa980, 0xa9cd,
  0xa9cf, 0xa9d9, 0xa9de, 0xa9fe, 0xaa00, 0xaa36, 0xaa40, 0xaa4d, 0xaa50, 0xaa59, 0xaa5c, 0xaac2, 0xaadb, 0xaaf6, 0xab01, 0xab06,
  0xab09, 0xab0e, 0xab11, 0xab16, 0xab20, 0xab26, 0xab28, 0xab2e, 0xab30, 0xab65, 0xab70, 0xabed, 0xabf0, 0xabf9, 0xac00, 0xd7a3,
  0xd7b0, 0xd7c6, 0xd7cb, 0xd7fb, 0xe000, 0xfa6d, 0xfa70, 0xfad9, 0xfb00, 0xfb06, 0xfb13, 0xfb17, 0xfb1d, 0xfb36, 0xfb38, 0xfb3c,
  0xfb3e, 0xfb3e, 0xfb40, 0xfb41, 0xfb43, 0xfb44, 0xfb46, 0xfbc1, 0xfbd3, 0xfd3f, 0xfd50, 0xfd8f, 0xfd92, 0xfdc7, 0xfdf0, 0xfdfd,
  0xfe00, 0xfe19, 0xfe20, 0xfe52, 0xfe54, 0xfe66, 0xfe68, 0xfe6b, 0xfe70, 0xfe74, 0xfe76, 0xfefc, 0xfeff, 0xfeff, 0xff01, 0xffbe,
  0xffc2, 0xffc7, 0xffca, 0xffcf, 0xffd2, 0xffd7, 0xffda, 0xffdc, 0xffe0, 0xffe6, 0xffe8, 0xffee, 0xfff9, 0xfffd, 0x10000, 0x1000b,
  0x1000d, 0x10026, 0x10028, 0x1003a, 0x1003c, 0x1003d, 0x1003f, 0x1004d, 0x10050, 0x1005d, 0x10080, 0x100fa, 0x10100, 0x10102, 0x10107, 0x10133,
  0x10137, 0x1018e, 0x10190, 0x1019b, 0x101a0, 0x101a0, 0x101d0, 0x101fd, 0x10280, 0x1029c, 0x102a0, 0x102d0, 0x102e0, 0x102fb, 0x10300, 0x10323,
  0x10330, 0x1034a, 0x10350, 0x1037a, 0x10380, 0x1039d, 0x1039f, 0x103c3, 0x103c8, 0x103d5, 0x10400, 0x1049d, 0x104a0, 0x104a9, 0x104b0, 0x104d3,
  0x104d8, 0x104fb, 0x10500, 0x10527, 0x10530, 0x10563, 0x1056f, 0x1056f, 0x10600, 0x10736, 0x10740, 0x10755, 0x10760, 0x10767, 0x10800, 0x10805,
  0x10808, 0x10808, 0x1080a, 0x10835, 0x10837, 0x10838, 0x1083c, 0x1083c, 0x1083f, 0x10855, 0x10857, 0x1089e, 0x108a7, 0x108af, 0x108e0, 0x108f2,
  0x108f4, 0x108f5, 0x108fb, 0x1091b, 0x1091f, 0x10939, 0x1093f, 0x1093f, 0x10980, 0x109b7, 0x109bc, 0x109cf, 0x109d2, 0x10a03, 0x10a05, 0x10a06,
  0x10a0c, 0x10a13, 0x10a15, 0x10a17, 0x10a19, 0x10a33, 0x10a38, 0x10a3a, 0x10a3f, 0x10a47, 0x10a50, 0x10a58, 0x10a60, 0x10a9f, 0x10ac0, 0x10ae6,
  0x10aeb, 0x10af6, 0x10b00, 0x10b35, 0x10b39, 0x10b55, 0x10b58, 0x10b72, 0x10b78, 0x10b91, 0x10b99, 0x10b9c, 0x10ba9, 0x10baf, 0x10c00, 0x10c48,
  0x10c80, 0x10cb2, 0x10cc0, 0x10cf2, 0x10cfa, 0x10cff, 0x10e60, 0x10e7e, 0x11000, 0x1104d, 0x11052, 0x1106f, 0x1107f, 0x110c1, 0x110d0, 0x110e8,
  0x110f0, 0x110f9, 0x11100, 0x11134, 0x11136, 0x11143, 0x11150, 0x11176, 0x11180, 0x111cd, 0x111d0, 0x111df, 0x111e1, 0x111f4, 0x11200, 0x11211,
  0x11213, 0x1123e, 0x11280, 0x11286, 0x11288, 0x11288, 0x1128a, 0x1128d, 0x1128f, 0x1129d, 0x1129f, 0x112a9, 0x112b0, 0x112ea, 0x112f0, 0x112f9,
  0x11300, 0x11303, 0x11305, 0x1130c, 0x1130f, 0x11310, 0x11313, 0x11328, 0x1132a, 0x11330, 0x11332, 0x11333, 0x11335, 0x11339, 0x1133c, 0x11344,
  0x11347, 0x11348, 0x1134b, 0x1134d, 0x11350, 0x11350, 0x11357, 0x11357, 0x1135d, 0x11363, 0x11366, 0x1136c, 0x11370, 0x11374, 0x11400, 0x11459,
  0x1145b, 0x1145b, 0x1145d, 0x1145d, 0x11480, 0x114c7, 0x114d0, 0x114d9, 0x11580, 0x115b5, 0x115b8, 0x115dd, 0x11600, 0x11644, 0x11650, 0x11659,
  0x11660, 0x1166c, 0x11680, 0x116b7, 0x116c0, 0x116c9, 0x11700, 0x11719, 0x1171d, 0x1172b, 0x11730, 0x1173f, 0x118a0, 0x118f2, 0x118ff, 0x118ff,
  0x11ac0, 0x11af8, 0x11c00, 0x11c08, 0x11c0a, 0x11c36, 0x11c38, 0x11c45, 0x11c50, 0x11c6c, 0x11c70, 0x11c8f, 0x11c92, 0x11ca7, 0x11ca9, 0x11cb6,
  0x12000, 0x12399, 0x12400, 0x1246e, 0x12470, 0x12474, 0x12480, 0x12543, 0x13000, 0x1342e, 0x14400, 0x14646, 0x16800, 0x16a38, 0x16a40, 0x16a5e,
  0x16a60, 0x16a69, 0x16a6e, 0x16a6f, 0x16ad0, 0x16aed, 0x16af0, 0x16af5, 0x16b00, 0x16b45, 0x16b50, 0x16b59, 0x16b5b, 0x16b61, 0x16b63, 0x16b77,
  0x16b7d, 0x16b8f, 0x16f00, 0x16f44, 0x16f50, 0x16f7e, 0x16f8f, 0x16f9f, 0x16fe0, 0x16fe0, 0x17000, 0x187ec, 0x18800, 0x18af2, 0x1b000, 0x1b001,
  0x1bc00, 0x1bc6a, 0x1bc70, 0x1bc7c, 0x1bc80, 0x1bc88, 0x1bc90, 0x1bc99, 0x1bc9c, 0x1bca3, 0x1d000, 0x1d0f5, 0x1d100, 0x1d126, 0x1d129, 0x1d1e8,
  0x1d200, 0x1d245, 0x1d300, 0x1d356, 0x1d360, 0x1d371, 0x1d400, 0x1d454, 0x1d456, 0x1d49c, 0x1d49e, 0x1d49f, 0x1d4a2, 0x1d4a2, 0x1d4a5, 0x1d4a6,
  0x1d4a9, 0x1d4ac, 0x1d4ae, 0x1d4b9, 0x1d4bb, 0x1d4bb, 0x1d4bd, 0x1d4c3, 0x1d4c5, 0x1d505, 0x1d507, 0x1d50a, 0x1d50d, 0x1d514, 0x1d516, 0x1d51c,
  0x1d51e, 0x1d539, 0x1d53b, 0x1d53e, 0x1d540, 0x1d544, 0x1d546, 0x1d546, 0x1d54a, 0x1d550, 0x1d552, 0x1d6a5, 0x1d6a8, 0x1d7cb, 0x1d7ce, 0x1da8b,
  0x1da9b, 0x1da9f, 0x1daa1, 0x1daaf, 0x1e000, 0x1e006, 0x1e008, 0x1e018, 0x1e01b, 0x1e021, 0x1e023, 0x1e024, 0x1e026, 0x1e02a, 0x1e800, 0x1e8c4,
  0x1e8c7, 0x1e8d6, 0x1e900, 0x1e94a, 0x1e950, 0x1e959, 0x1e95e, 0x1e95f, 0x1ee00, 0x1ee03, 0x1ee05, 0x1ee1f, 0x1ee21, 0x1ee22, 0x1ee24, 0x1ee24,
  0x1ee27, 0x1ee27, 0x1ee29, 0x1ee32, 0x1ee34, 0x1ee37, 0x1ee39, 0x1ee39, 0x1ee3b, 0x1ee3b, 0x1ee42, 0x1ee42, 0x1ee47, 0x1ee47, 0x1ee49, 0x1ee49,
  0x1ee4b, 0x1ee4b, 0x1ee4d, 0x1ee4f, 0x1ee51, 0x1ee52, 0x1ee54, 0x1ee54, 0x1ee57, 0x1ee57, 0x1ee59, 0x1ee59, 0x1ee5b, 0x1ee5b, 0x1ee5d, 0x1ee5d,
  0x1ee5f, 0x1ee5f, 0x1ee61, 0x1ee62, 0x1ee64, 0x1ee64, 0x1ee67, 0x1ee6a, 0x1ee6c, 0x1ee72, 0x1ee74, 0x1ee77, 0x1ee79, 0x1ee7c, 0x1ee7e, 0x1ee7e,
  0x1ee80, 0x1ee89, 0x1ee8b, 0x1ee9b, 0x1eea1, 0x1eea3, 0x1eea5, 0x1eea9, 0x1eeab, 0x1eebb, 0x1eef0, 0x1eef1, 0x1f000, 0x1f02b, 0x1f030, 0x1f093,
  0x1f0a0, 0x1f0ae, 0x1f0b1, 0x1f0bf, 0x1f0c1, 0x1f0cf, 0x1f0d1, 0x1f0f5, 0x1f100, 0x1f10c, 0x1f110, 0x1f12e, 0x1f130, 0x1f16b, 0x1f170, 0x1f1ac,
  0x1f1e6, 0x1f202, 0x1f210, 0x1f23b, 0x1f240, 0x1f248, 0x1f250, 0x1f251, 0x1f300, 0x1f6d2, 0x1f6e0, 0x1f6ec, 0x1f6f0, 0x1f6f6, 0x1f700, 0x1f773,
  0x1f780, 0x1f7d4, 0x1f800, 0x1f80b, 0x1f810, 0x1f847, 0x1f850, 0x1f859, 0x1f860, 0x1f887, 0x1f890, 0x1f8ad, 0x1f910, 0x1f91e, 0x1f920, 0x1f927,
  0x1f930, 0x1f930, 0x1f933, 0x1f93e, 0x1f940, 0x1f94b, 0x1f950, 0x1f95e, 0x1f980, 0x1f991, 0x1f9c0, 0x1f9c0, 0x20000, 0x2a6d6, 0x2a700, 0x2b734,
  0x2b740, 0x2b81d, 0x2b820, 0x2cea1, 0x2f800, 0x2fa1d, 0xe0001, 0xe0001, 0xe0020, 0xe007f, 0xe0100, 0xe01ef, 0xf0000, 0xffffd, 0x100000, 0x10fffd,
];

function unicodeLocale(context: CommandContext): boolean {
  const locale = (context.env.LC_ALL || context.env.LC_CTYPE || context.env.LANG || "C").toLowerCase();
  return locale.endsWith("utf-8") || locale.endsWith("utf8");
}

function quote(bytes: Uint8Array, shell: boolean, unicode = false): string {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const units: { text: string; bytes: Uint8Array; valid: boolean }[] = [];
  for (let offset = 0; offset < bytes.length;) {
    const first = bytes[offset]!;
    let length = 1;
    let text = String.fromCharCode(first);
    let valid = first < 128;
    if (unicode && first >= 0xc2 && first <= 0xf4) {
      const size = first < 0xe0 ? 2 : first < 0xf0 ? 3 : 4;
      try { text = decoder.decode(bytes.subarray(offset, offset + size)); length = size; valid = true; }
      catch { valid = false; }
    }
    units.push({ text, bytes: bytes.subarray(offset, offset + length), valid });
    offset += length;
  }
  const escapes: Readonly<Record<string, string>> = { "\u0007": "\\a", "\b": "\\b", "\t": "\\t", "\n": "\\n", "\v": "\\v", "\f": "\\f", "\r": "\\r" };
  const printable = (unit: typeof units[number]): boolean => {
    if (!unit.valid) return false;
    const point = unit.text.codePointAt(0)!;
    if (point < 128) return point >= 32 && point < 127;
    if (!unicode) return false;
    let low = 0;
    let high = glibc231PrintableRanges.length / 2;
    while (low < high) {
      const middle = Math.trunc((low + high) / 2);
      if (point < glibc231PrintableRanges[middle * 2]!) high = middle;
      else if (point > glibc231PrintableRanges[middle * 2 + 1]!) low = middle + 1;
      else return true;
    }
    return false;
  };
  if (shell && bytes.includes(39) && units.every((unit, index) =>
    printable(unit) && !'!"$&()*;<=>?[^`|\\{}'.includes(unit.text) && (index === 0 || !"#~".includes(unit.text))
  )) return `"${units.map(unit => unit.text).join("")}"`;
  const left = !shell && unicode ? "‘" : "'";
  const right = !shell && unicode ? "’" : "'";
  let result = left;
  let escaping = shell && bytes.includes(39) && units.length > 0 && !printable(units[units.length - 1]!);
  for (const unit of units) {
    if (shell && unit.text === "'") { result += "'\\''"; escaping = false; }
    else if (!printable(unit)) {
      if (shell && !escaping) result += "'$'";
      escaping = true;
      result += escapes[unit.text] ?? Array.from(unit.bytes, byte => `\\${byte.toString(8).padStart(3, "0")}`).join("");
    } else {
      if (shell && escaping) result += "''";
      escaping = false;
      if (!shell && (unit.text === right || unit.text === "\\")) result += "\\";
      result += unit.text;
    }
  }
  return result + right;
}

function fileError(error: unknown, name: string, bytes: Uint8Array, opening: boolean, context: CommandContext): unknown {
  if (!(error instanceof FsError)) return error;
  const messages: Readonly<Record<string, string>> = { ENOENT: "No such file or directory", EACCES: "Permission denied", EISDIR: "Is a directory", ENOTDIR: "Not a directory", ELOOP: "Too many levels of symbolic links", EIO: "Input/output error", EBADF: "Bad file descriptor" };
  const message = messages[error.code];
  if (!message) return error;
  return new PublicDiagnostic(`${opening ? `cannot open ${quote(bytes, true, unicodeLocale(context))} for reading` : name === "-" ? "standard input" : name}: ${message}`);
}

export function fmtCommand(): CommandDefinition {
  return { name: "fmt", filesystemRequirements: inputRequirements, async execute(context) {
    context.signal.throwIfAborted();
    const controller = new AbortController();
    const local = { ...context, signal: AbortSignal.any([context.signal, controller.signal]) };
    let current: InputScope | undefined;
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      if (!closing) {
        controller.abort(new FsError("EPIPE", { message: "fmt input closed" }));
        closing = current?.close() ?? Promise.resolve();
      }
      return closing;
    };
    context.registerCleanup?.(close);
    let failed = false;
    const run = async () => {
      try {
        const settings = parse(context);
        if (settings.information) {
          await output(context, settings.information === "version" ? "fmt (virtual-bash)\n" : "Usage: fmt [-WIDTH] [OPTION]... [FILE]...\nReformat paragraphs; omitted FILE or '-' reads standard input.\n  -c, --crown-margin       preserve indentation of first two lines\n  -t, --tagged-paragraph   use distinct first and following margins\n  -p, --prefix=STRING      format only lines with this prefix\n  -s, --split-only         split lines without joining\n  -u, --uniform-spacing    one space between words, two after sentences\n  -w, --width=WIDTH        maximum width (default 75)\n  -g, --goal=WIDTH         preferred width (default 93% of width)\n      --help              display this help\n      --version           display virtual command identity\n");
          return { exitCode: 0 };
        }
        const budget = new ByteInputBudget(bufferLimit);
        const work = new WorkBudget();
        let stdinDone = false;
        let emptyChunks = 0;
        let chunks = 0;
        let exitCode = 0;
        for (const { name, bytes: nameBytes } of settings.files) {
          local.signal.throwIfAborted();
          if (name === "-" && stdinDone) continue;
          current = new InputScope(local, budget);
          try { await current.open(name, nameBytes); }
          catch (error) {
            local.signal.throwIfAborted();
            await diagnostic(context, fileError(error, name, nameBytes, true, context));
            await current.close();
            exitCode = 1;
            continue;
          }
          const machine = new Formatter(settings, work).run();
          let step = machine.next();
          let readFailed = false;
          let readError: unknown;
          let received = false;
          while (!step.done) {
            local.signal.throwIfAborted();
            if (step.value === "input") {
              let bytes: Uint8Array | null = null;
              if (!readFailed) {
                try { bytes = await current.next(); if (bytes?.length) received = true; }
                catch (error) {
                  local.signal.throwIfAborted();
                  if (isFsError(error, "EFBIG")) throw new PublicDiagnostic("byte command input limit exceeded");
                  readFailed = true;
                  readError = !received && name !== "-" && error instanceof FsError && ["ENOENT", "EACCES", "ENOTDIR", "ELOOP"].includes(error.code) ? fileError(error, name, nameBytes, true, context) : error;
                }
              }
              if (bytes?.length === 0 && ++emptyChunks > 4096) throw new PublicDiagnostic("empty input chunk limit exceeded");
              if (++chunks % 64 === 0) await yieldTurn(local.signal);
              step = machine.next(bytes);
            } else {
              if (step.value) await output(context, step.value);
              else await yieldTurn(local.signal);
              step = machine.next();
            }
          }
          try { await current.close(); }
          catch (error) { if (!readFailed) throw error; }
          current = undefined;
          if (name === "-") stdinDone = true;
          if (readFailed && !isFsError(readError, "EISDIR") && !isFsError(readError, "EIO") && !isFsError(readError, "EBADF")) { await diagnostic(context, fileError(readError, name, nameBytes, false, context)); exitCode = 1; }
        }
        return { exitCode };
      } catch (error) {
        failed = true;
        context.signal.throwIfAborted();
        if (error instanceof OptionDiagnostic) await writeBytes(context.stderr, error.bytes, context.signal);
        else await diagnostic(context, error);
        return { exitCode: 1 };
      }
    };
    let outcome: { result: { exitCode: number } } | { error: unknown };
    try { outcome = { result: await run() }; }
    catch (error) { outcome = { error }; }
    try { await close(); }
    catch (error) { if (!failed) throw error; }
    if ("error" in outcome) throw outcome.error;
    return outcome.result;
  } };
}
