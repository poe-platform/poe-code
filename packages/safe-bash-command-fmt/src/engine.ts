import { FmtError, defaultFmtLimits, validateFmtLimits, validateFmtProfile, type FmtLimits, type FmtOptions } from './contracts.js';
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
  /** Single-use coroutine: send owned/admitted bytes on 'input', or null for EOF.
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
  retained = 0;
  peakRetained = 0;
  private sinceCheckpoint = 0;
  private signalAborted: boolean;
  private readonly pollSignal: boolean;
  constructor(readonly limits: FmtLimits, readonly signal: AbortSignal) {
    this.signalAborted = signal.aborted;
    this.pollSignal = Object.prototype.hasOwnProperty.call(signal, "aborted");
    if (!this.signalAborted && !this.pollSignal) {
      signal.addEventListener("abort", () => { this.signalAborted = true; }, { once: true });
    }
  }
  check(): void {
    if (this.closed) throw new FmtError('CLOSED', 'fmt engine is closed');
    if (this.pollSignal ? this.signal.aborted : this.signalAborted) throw new FmtError('CANCELLED', 'fmt engine cancelled');
  }
  tick(count = 1): boolean {
    this.charge(count);
    if (this.sinceCheckpoint >= 1024) {
      this.sinceCheckpoint = 0;
      return true;
    }
    return false;
  }
  *checkpoint(): FmtMachine {
    if ((yield undefined) !== undefined) throw new FmtError('INPUT', 'Unexpected input on fmt checkpoint event');
    this.check();
  }
  *step(count = 1): FmtMachine {
    if (this.tick(count)) yield* this.checkpoint();
  }
  charge(count: number): void {
    this.check();
    if (count > this.limits.work - this.operations) throw new FmtError('LIMIT', 'work limit exceeded');
    this.operations += count; this.sinceCheckpoint += count;
  }
  admitInput(size: number): void {
    this.check();
    if (size > (this.limits.chunkBytes ?? Infinity) || size > this.limits.inputBytes - this.input) throw new FmtError('LIMIT', 'input byte or bounded-call limit exceeded');
    this.input += size;
  }
  admitOutput(): void {
    if (this.output === this.limits.outputBytes) throw new FmtError('LIMIT', 'output limit exceeded');
    this.output++;
  }
  admitOutputBytes(count: number): void {
    if (count > this.limits.outputBytes - this.output) throw new FmtError('LIMIT', 'output limit exceeded');
    this.output += count;
  }
  exact(value: number): number {
    if ((value | 0) !== value && !Number.isSafeInteger(value)) throw new FmtError('ARITHMETIC', 'fmt exact arithmetic limit exceeded');
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

  private *readSlow(alreadyTicked: boolean): FmtMachine<number> {
    if (!alreadyTicked && this.budget.tick()) yield* this.budget.checkpoint();
    else if (alreadyTicked) yield* this.budget.checkpoint();
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
      if (view.length > this.chunk.length) {
        const retained = this.budget.retained - this.chunk.length + view.length;
        if (this.budget.retained + view.length > this.budget.limits.retainedBytes) throw new FmtError('LIMIT', 'fmt buffer retention limit exceeded');
        this.budget.peakRetained = Math.max(this.budget.peakRetained, this.budget.retained + view.length);
        this.chunk = new Uint8Array(view.length);
        this.budget.retained = retained;
      }
      let position = 0;
      for (const byte of view.values) this.chunk[position++] = byte;
      this.chunkUsed = view.length;
      this.offset = 0;
      if (this.budget.tick(0)) yield* this.budget.checkpoint();
    }
    return this.chunk[this.offset++]!;
  }

  private *read(): FmtMachine<number> {
    if (this.offset < this.chunkUsed) {
      if (!this.budget.tick()) return this.chunk[this.offset++]!;
      yield* this.budget.checkpoint();
      if (this.offset < this.chunkUsed) return this.chunk[this.offset++]!;
    }
    return yield* this.readSlow(false);
  }

  private emitFast(byte: number): boolean {
    const needCheckpoint = this.budget.tick();
    this.budget.admitOutput();
    this.pending[this.pendingUsed++] = byte;
    return needCheckpoint || this.pendingUsed === this.pending.length;
  }

  private *flushEmit(needCheckpoint: boolean): FmtMachine {
    if (needCheckpoint) yield* this.budget.checkpoint();
    if (this.pendingUsed === this.pending.length) {
      if ((yield this.pending.slice()) !== undefined) throw new FmtError('INPUT', 'Unexpected input on fmt output event');
      this.pendingUsed = 0;
    }
  }

  private *emit(byte: number): FmtMachine {
    if (this.budget.tick()) yield* this.budget.checkpoint();
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
        { const _b = 9; const _cp = this.budget.tick(); this.budget.admitOutput(); this.pending[this.pendingUsed++] = _b; if (_cp || this.pendingUsed === this.pending.length) yield* this.flushEmit(_cp); }
        this.outColumn = (Math.trunc(this.outColumn / 8) + 1) * 8;
      }
    }
    while (this.outColumn < target) { { const _b = 32; const _cp = this.budget.tick(); this.budget.admitOutput(); this.pending[this.pendingUsed++] = _b; if (_cp || this.pendingUsed === this.pending.length) yield* this.flushEmit(_cp); } this.outColumn++; }
  }

  private *whitespace(byte: number): FmtMachine<number> {
    while (byte === 32 || byte === 9) {
      if (byte === 32) this.column = this.budget.exact(this.column + 1);
      else { this.tabs = true; this.column = this.budget.exact((Math.trunc(this.column / 8) + 1) * 8); }
      byte = (this.offset < this.chunkUsed && !this.budget.tick()) ? this.chunk[this.offset++]! : yield* this.readSlow(this.offset < this.chunkUsed);
    }
    return byte;
  }

  private *lineStart(): FmtMachine<number> {
    this.column = 0;
    if (this.settings.prefix.length === 0 && this.offset < this.chunkUsed && this.chunk[this.offset] !== 32 && this.chunk[this.offset] !== 9) {
      if (this.budget.tick()) yield* this.budget.checkpoint();
      this.nextPrefix = 0;
      return this.chunk[this.offset++]!;
    }
    let byte = yield* this.whitespace(yield* this.read());
    const { prefix, leading } = this.settings;
    this.nextPrefix = prefix.length ? this.column : Math.min(leading, this.column);
    if (prefix.length) {
      for (const expected of prefix) {
        if (byte !== expected) return byte;
        this.column++;
        byte = (this.offset < this.chunkUsed && !this.budget.tick()) ? this.chunk[this.offset++]! : yield* this.readSlow(this.offset < this.chunkUsed);
      }
      if (byte === 32 && this.offset < this.chunkUsed && this.chunk[this.offset] !== 32 && this.chunk[this.offset] !== 9) {
        if (this.budget.tick()) yield* this.budget.checkpoint();
        this.column = this.budget.exact(this.column + 1);
        byte = this.chunk[this.offset++]!;
      } else byte = yield* this.whitespace(byte);
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
    const words = this.words;
    const count = words.length;
    const costs = this.costs;
    const breaks = this.breaks;
    const lengths = this.lengths;
    const goal = this.settings.goal;
    const maxLen = this.settings.profile === 'gnu-coreutils-8.30-C-bytes' ? this.settings.width - 1 : this.settings.width;
    const firstIndent = this.firstIndent;
    const otherIndent = this.otherIndent;
    const lastLength = this.lastLength;
    const budget = this.budget;
    costs[count] = 0;
    for (let start = count - 1; start >= 0; start--) {
      const word = words[start]!;
      let penalty = 4900;
      const previous = words[start - 1];
      if (previous !== undefined) {
        if (previous.period) penalty += previous.final ? -2500 : 360000;
        else if (previous.punctuation) penalty -= 1600;
        else if (words[start - 2]?.final) penalty += (40000 / (previous.length + 2)) | 0;
      }
      if (word.opening) penalty -= 1600;
      else if (word.final) penalty += (22500 / (word.length + 2)) | 0;
      let length = (start === 0 ? firstIndent : otherIndent) + word.length;
      let best = Infinity;
      for (let end = start + 1; ; end++) {
        if (budget.tick()) { yield undefined; budget.check(); }
        let cost = costs[end]!;
        if (end !== count) {
          const dg = goal - length;
          cost += 100 * dg * dg;
          if (breaks[end] !== count) {
            const dl = length - lengths[end]!;
            cost += 50 * dl * dl;
          }
        }
        if (start === 0 && lastLength > 0) {
          const dll = length - lastLength;
          cost += 50 * dll * dll;
        }
        if ((cost | 0) !== cost && !Number.isSafeInteger(cost)) budget.exact(cost);
        if (cost < best) { best = cost; breaks[start] = end; lengths[start] = length; }
        if (end === count) break;
        length += words[end - 1]!.space + words[end]!.length;
        if (length > maxLen) break;
      }
      const totalCost = best + penalty;
      if ((totalCost | 0) !== totalCost && !Number.isSafeInteger(totalCost)) budget.exact(totalCost);
      costs[start] = totalCost;
    }
  }

  private *render(finish: number): FmtMachine {
    for (let start = 0; start < finish; start = this.breaks[start]!) {
      this.outColumn = 0;
      if (this.prefixIndent > 0) yield* this.spaces(this.prefixIndent);
      for (const byte of this.settings.prefix) { const _b = byte; const _cp = this.budget.tick(); this.budget.admitOutput(); this.pending[this.pendingUsed++] = _b; if (_cp || this.pendingUsed === this.pending.length) yield* this.flushEmit(_cp); }
      this.outColumn += this.settings.prefix.length;
      const indentNeeded = (start === 0 ? this.firstIndent : this.otherIndent) - this.outColumn;
      if (indentNeeded > 0) yield* this.spaces(indentNeeded);
      const end = this.breaks[start]!;
      for (let index = start; index < end; index++) {
        const word = this.words[index]!;
        if (this.pendingUsed + word.length < this.pending.length && word.length <= this.budget.limits.outputBytes - this.budget.output) {
          const _cp = this.budget.tick(word.length);
          this.budget.admitOutputBytes(word.length);
          this.pending.set(this.text.subarray(word.start, word.start + word.length), this.pendingUsed);
          this.pendingUsed += word.length;
          if (_cp) yield* this.flushEmit(true);
        } else {
          for (let position = word.start; position < word.start + word.length; position++) { const _b = this.text[position]!; const _cp = this.budget.tick(); this.budget.admitOutput(); this.pending[this.pendingUsed++] = _b; if (_cp || this.pendingUsed === this.pending.length) yield* this.flushEmit(_cp); }
        }
        this.outColumn += word.length;
        if (index + 1 !== end) { if (!this.tabs && word.space === 1) { this.budget.exact(this.outColumn + 1); const _cp = this.budget.tick(); this.budget.admitOutput(); this.pending[this.pendingUsed++] = 32; if (_cp || this.pendingUsed === this.pending.length) yield* this.flushEmit(_cp); this.outColumn++; } else yield* this.spaces(word.space); }
      }
      this.lastLength = this.outColumn;
      { const _b = 10; const _cp = this.budget.tick(); this.budget.admitOutput(); this.pending[this.pendingUsed++] = _b; if (_cp || this.pendingUsed === this.pending.length) yield* this.flushEmit(_cp); }
    }
  }

  private *makeRoom(current: Word): FmtMachine {
    this.secondary(true);
    if (!this.words.length) {
      for (let position = 0; position < this.used; position++) { const _b = this.text[position]!; const _cp = this.budget.tick(); this.budget.admitOutput(); this.pending[this.pendingUsed++] = _b; if (_cp || this.pendingUsed === this.pending.length) yield* this.flushEmit(_cp); }
      this.used = 0;
      current.start = 0;
      return;
    }
    yield* this.optimize();
    let cut = this.words.length;
    let score = Infinity;
    for (let line = this.breaks[0]!; line !== this.words.length; line = this.breaks[line]!) {
      if (this.budget.tick()) yield* this.budget.checkpoint();
      const candidate = this.costs[line]! - this.costs[this.breaks[line]!]!;
      if (candidate < score) { cut = line; score = candidate; }
      score += 9;
    }
    yield* this.render(cut);
    const offset = cut === this.words.length ? current.start : this.words[cut]!.start;
    if (this.budget.tick(this.used - offset + this.words.length)) yield* this.budget.checkpoint();
    this.text.copyWithin(0, offset, this.used);
    this.used -= offset;
    this.words = this.words.slice(cut);
    for (const word of this.words) word.start -= offset;
    current.start -= offset;
  }

  private *readLine(byte: number): FmtMachine<number> {
    do {
      const word: Word = { start: this.used, length: 0, space: 0, opening: false, period: false, punctuation: false, final: false };
      while (true) {
        if (this.used === this.text.length) yield* this.makeRoom(word);
        this.text[this.used++] = byte;
        const maxFast = Math.min(this.chunkUsed - this.offset, this.text.length - this.used);
        if (maxFast > 0) {
          let scan = 0;
          while (scan < maxFast) {
            const b = this.chunk[this.offset + scan]!;
            if (b === 32 || (b >= 9 && b <= 13)) break;
            this.text[this.used + scan] = b;
            scan++;
          }
          if (scan > 0) {
            this.used += scan;
            this.offset += scan;
            if (this.budget.tick(scan)) yield* this.budget.checkpoint();
          }
        }
        byte = (this.offset < this.chunkUsed && !this.budget.tick()) ? this.chunk[this.offset++]! : yield* this.readSlow(this.offset < this.chunkUsed);
        if (byte === -1 || byte === 32 || (byte >= 9 && byte <= 13)) break;
      }
      word.length = this.used - word.start;
      this.column = this.budget.exact(this.column + word.length);
      const first = this.text[word.start]!;
      const last = this.text[this.used - 1]!;
      word.opening = first === 0 || first === 40 || first === 91 || first === 39 || first === 96 || first === 34;
      word.punctuation = last >= 33 && last <= 47 || last >= 58 && last <= 64 || last >= 91 && last <= 96 || last >= 123 && last <= 126;
      let terminal = this.used - 1;
      if (this.budget.tick(word.length)) yield* this.budget.checkpoint();
      while (terminal > word.start) { const tb = this.text[terminal]!; if (tb !== 0 && tb !== 41 && tb !== 93 && tb !== 39 && tb !== 34) break; terminal--; }
      { const pb = this.text[terminal]!; word.period = pb === 0 || pb === 46 || pb === 63 || pb === 33; }
      const before = this.column;
      if (byte === 32 && this.offset < this.chunkUsed && this.chunk[this.offset] !== 32 && this.chunk[this.offset] !== 9) {
        if (this.budget.tick()) yield* this.budget.checkpoint();
        this.column = this.budget.exact(this.column + 1);
        byte = this.chunk[this.offset++]!;
      } else byte = yield* this.whitespace(byte);
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
            { const _b = prefixByte; const _cp = this.budget.tick(); this.budget.admitOutput(); this.pending[this.pendingUsed++] = _b; if (_cp || this.pendingUsed === this.pending.length) yield* this.flushEmit(_cp); }
            this.outColumn++;
          }
          if (byte !== -1 && byte !== 10) yield* this.spaces(this.column - this.outColumn);
          if (byte === -1 && this.column >= this.nextPrefix + this.settings.prefix.length) { const _b = 10; const _cp = this.budget.tick(); this.budget.admitOutput(); this.pending[this.pendingUsed++] = _b; if (_cp || this.pendingUsed === this.pending.length) yield* this.flushEmit(_cp); }
        }
        while (byte !== -1 && byte !== 10) { { const _b = byte; const _cp = this.budget.tick(); this.budget.admitOutput(); this.pending[this.pendingUsed++] = _b; if (_cp || this.pendingUsed === this.pending.length) yield* this.flushEmit(_cp); } byte = (this.offset < this.chunkUsed && !this.budget.tick()) ? this.chunk[this.offset++]! : yield* this.readSlow(this.offset < this.chunkUsed); }
        if (byte === -1) break;
        { const _b = 10; const _cp = this.budget.tick(); this.budget.admitOutput(); this.pending[this.pendingUsed++] = _b; if (_cp || this.pendingUsed === this.pending.length) yield* this.flushEmit(_cp); }
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


export function createFmtEngine(options: FmtOptions, configuration: Partial<FmtLimits>, signal: AbortSignal): FmtEngine {
  const limits = { ...defaultFmtLimits, ...configuration };
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
  budget.retained = budget.peakRetained = retained;
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
    accounting: () => Object.freeze({ inputBytes: budget.input, decodedBytes: 0, outputBytes: budget.output, work: budget.operations, retainedBytes: budget.closed ? 0 : budget.retained, peakRetainedBytes: budget.peakRetained }),
  };
}
