import { FmtError, validateFmtLimits, validateFmtProfile, type FmtLimits, type FmtOptions } from './contracts.js';
import { byteView, ownedBytes } from './bytes.js';

export interface FmtAccounting {
  readonly inputBytes: number;
  /** Formatting never decodes input: words and widths retain their byte identity. */
  readonly decodedBytes: 0;
  readonly outputBytes: number;
  readonly work: number;
  readonly retainedBytes: number;
  readonly peakRetainedBytes: number;
}
export interface FmtEngine {
  /** Single-use coroutine: send <=4096 owned/admitted bytes on 'input', or null for EOF.
   * Uint8Array events are owned output; undefined events are cooperative checkpoints.
   * Do not send bytes on output/checkpoint events. */
  run(): FmtMachine;
  dispose(): void;
  accounting(): FmtAccounting;
}
class WorkBudget {
  operations = 0;
  output = 0;
  input = 0;
  closed = false;
  private sinceCheckpoint = 0;
  constructor(readonly limits: FmtLimits, readonly signal: AbortSignal) {}
  check(): void {
    if (this.closed) throw new FmtError('CLOSED', 'fmt engine is closed');
    if (this.signal.aborted) throw new FmtError('CANCELLED', 'fmt engine cancelled');
  }
  *step(count = 1): FmtMachine {
    this.charge(count);
    if (this.sinceCheckpoint >= 1024) {
      this.sinceCheckpoint = 0;
      if ((yield undefined) !== undefined) throw new FmtError('INPUT', 'Unexpected input on fmt checkpoint event');
    }
    this.check();
  }
  charge(count: number): void {
    this.check();
    if (count > this.limits.work - this.operations) throw new FmtError('LIMIT', 'work limit exceeded');
    this.operations += count; this.sinceCheckpoint += count;
  }
  admitInput(size: number): void {
    this.check();
    if (size > 4096 || size > this.limits.inputBytes - this.input) throw new FmtError('LIMIT', 'input byte or bounded-call limit exceeded');
    this.input += size;
  }
  admitOutput(): void {
    if (this.output === this.limits.outputBytes) throw new FmtError('LIMIT', 'output limit exceeded');
    this.output++;
  }
  exact(value: number): number {
    if (!Number.isSafeInteger(value)) throw new FmtError('ARITHMETIC', 'fmt exact arithmetic limit exceeded');
    return value;
  }
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

export type FmtMachine<Result = void> = Generator<Uint8Array | "input" | undefined, Result, Uint8Array | null | undefined>;

class Formatter {
  private chunk: Uint8Array = new Uint8Array(4096);
  private chunkUsed = 0;
  private offset = 0;
  private eof = false;
  private pending = new Uint8Array(1024);
  private pendingUsed = 0;
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

  constructor(private settings: FmtOptions, private budget: WorkBudget) {}

  private *read(): FmtMachine<number> {
    yield* this.budget.step();
    while (this.offset === this.chunkUsed) {
      if (this.eof) return -1;
      const incoming = yield "input";
      this.budget.check();
      if (incoming === null) { this.eof = true; return -1; }
      if (incoming === undefined) throw new FmtError("INPUT", "Expected input bytes or null EOF");
      const view = byteView(incoming);
      // Admission and copy complete in the resumption that receives borrowed
      // input; a checkpoint must never hand control back before ownership.
      this.budget.charge(view.length + 1);
      this.budget.admitInput(view.length);
      let position = 0;
      for (const byte of view.values) this.chunk[position++] = byte;
      this.chunkUsed = view.length;
      this.offset = 0;
      yield* this.budget.step(0);
    }
    return this.chunk[this.offset++]!;
  }

  private *emit(byte: number): FmtMachine {
    yield* this.budget.step();
    this.budget.admitOutput();
    this.pending[this.pendingUsed++] = byte;
    if (this.pendingUsed === this.pending.length) {
      if ((yield this.pending.slice()) !== undefined) throw new FmtError('INPUT', 'Unexpected input on fmt output event');
      this.pendingUsed = 0;
    }
  }

  private *spaces(count: number): FmtMachine {
    const target = this.budget.exact(this.outColumn + count);
    const tabEnd = Math.trunc(target / 8) * 8;
    if (this.tabs && this.outColumn + 1 < tabEnd) {
      while (this.outColumn < tabEnd) {
        yield* this.emit(9);
        this.outColumn = (Math.trunc(this.outColumn / 8) + 1) * 8;
      }
    }
    while (this.outColumn < target) { yield* this.emit(32); this.outColumn++; }
  }

  private *whitespace(byte: number): FmtMachine<number> {
    while (byte === 32 || byte === 9) {
      if (byte === 32) this.column = this.budget.exact(this.column + 1);
      else { this.tabs = true; this.column = this.budget.exact((Math.trunc(this.column / 8) + 1) * 8); }
      byte = yield* this.read();
    }
    return byte;
  }

  private *lineStart(): FmtMachine<number> {
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

  private *optimize(): FmtMachine {
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
        this.budget.exact(cost);
        if (cost < best) { best = cost; this.breaks[start] = end; this.lengths[start] = length; }
        if (end === count) break;
        length += this.words[end - 1]!.space + this.words[end]!.length;
        if (this.settings.profile === 'gnu-coreutils-8.30-C-bytes' ? length >= this.settings.width : length > this.settings.width) break;
      }
      this.costs[start] = this.budget.exact(best + penalty);
    }
  }

  private *render(finish: number): FmtMachine {
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

  private *makeRoom(current: Word): FmtMachine {
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
      yield* this.budget.step();
      const candidate = this.costs[line]! - this.costs[this.breaks[line]!]!;
      if (candidate < score) { cut = line; score = candidate; }
      score += 9;
    }
    yield* this.render(cut);
    const offset = cut === this.words.length ? current.start : this.words[cut]!.start;
    yield* this.budget.step(this.used - offset + this.words.length);
    this.text.copyWithin(0, offset, this.used);
    this.used -= offset;
    this.words = this.words.slice(cut);
    for (const word of this.words) word.start -= offset;
    current.start -= offset;
  }

  private *readLine(byte: number): FmtMachine<number> {
    do {
      const word: Word = { start: this.used, length: 0, space: 0, opening: false, period: false, punctuation: false, final: false };
      do {
        if (this.used === this.text.length) yield* this.makeRoom(word);
        this.text[this.used++] = byte;
        byte = yield* this.read();
      } while (byte !== -1 && byte !== 32 && !(byte >= 9 && byte <= 13));
      word.length = this.used - word.start;
      this.column = this.budget.exact(this.column + word.length);
      const first = this.text[word.start]!;
      const last = this.text[this.used - 1]!;
      word.opening = first === 0 || "(['`\"".includes(String.fromCharCode(first));
      word.punctuation = last >= 33 && last <= 47 || last >= 58 && last <= 64 || last >= 91 && last <= 96 || last >= 123 && last <= 126;
      let terminal = this.used - 1;
      yield* this.budget.step(word.length);
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

  dispose(): void {
    this.chunk = new Uint8Array(); this.pending = new Uint8Array(); this.text = new Uint8Array();
    this.chunkUsed = this.pendingUsed = this.used = 0; this.words = []; this.costs = []; this.breaks = []; this.lengths = [];
    this.settings = { ...this.settings, prefix: new Uint8Array(), files: [] };
  }

  *run(): FmtMachine {
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
    if (this.pendingUsed) {
      if ((yield this.pending.slice(0, this.pendingUsed)) !== undefined) throw new FmtError('INPUT', 'Unexpected input on fmt output event');
      this.pendingUsed = 0;
    }
  }
}


export function createFmtEngine(options: FmtOptions, limits: FmtLimits, signal: AbortSignal): FmtEngine {
  if (signal.aborted) throw new FmtError('CANCELLED', 'fmt engine cancelled');
  validateFmtLimits(limits); validateFmtProfile(options.profile);
  for (const [value, maximum] of [[options.width, 2500], [options.goal, options.width], [options.leading, limits.argumentBytes], [options.fullPrefix, limits.argumentBytes]]) {
    if (!Number.isSafeInteger(value) || value! < 0 || value! > maximum!) throw new FmtError('WIDTH', 'Invalid fmt width, goal or prefix indentation');
  }
  const prefixSize = byteView(options.prefix).length;
  const retained = 5000 + 4096 + 1024 + prefixSize;
  if (retained > limits.retainedBytes) throw new FmtError('LIMIT', 'fmt buffer retention limit exceeded');
  let prefix = ownedBytes(options.prefix, limits.argumentBytes);
  const budget = new WorkBudget(Object.freeze({ ...limits }), signal);
  const formatter = new Formatter({ ...options, prefix, files: [] }, budget);
  let started = false;
  const dispose = (): void => { budget.closed = true; formatter.dispose(); prefix.fill(0); prefix = new Uint8Array(); };
  return {
    *run() {
      if (started) throw new FmtError('CLOSED', 'fmt engine has already started');
      started = true;
      try { budget.check(); yield* formatter.run(); budget.check(); } finally { dispose(); }
    },
    dispose,
    accounting: () => Object.freeze({ inputBytes: budget.input, decodedBytes: 0, outputBytes: budget.output, work: budget.operations, retainedBytes: budget.closed ? 0 : retained, peakRetainedBytes: retained }),
  };
}
