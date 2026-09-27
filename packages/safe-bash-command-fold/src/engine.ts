import { ASCII_UNITS, decodeFoldUnit, type FoldUnit } from "./units.js";
import { FoldError, defaultFoldLimits, validateLimits, type FoldLimits, type FoldOptions } from './contracts.js';
import { adjustFoldColumn } from './column.js';
// Inspect intrinsic slots across realms; producer properties must not change
// byte admission, accounting or iteration (Buffer is also a Uint8Array).
const byteViewPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const byteType = Object.getOwnPropertyDescriptor(byteViewPrototype, Symbol.toStringTag)!.get!;
const byteLength = Object.getOwnPropertyDescriptor(byteViewPrototype, 'byteLength')!.get!;
const byteValues = Uint8Array.prototype.values;
export interface FoldAccounting {
  readonly inputBytes: number;
  readonly decodedBytes: number;
  /** Live line and decoder-prefix bytes; delivered chunks belong to the caller. */
  readonly retainedBytes: number;
  readonly peakRetainedBytes: number;
  readonly outputBytes: number;
  readonly work: number;
}
export interface FoldEngine {
  /** At most 4096 bytes per bounded call. Returned chunks own their storage. */
  push(bytes: Uint8Array): readonly Uint8Array[];
  /** Flush incomplete decoding and reset file column, preserving prior glyph width. */
  endFile(): readonly Uint8Array[];
  /** Idempotently discard invocation-owned state; further input is rejected. */
  dispose(): void;
  /** Immutable invocation counters, also available after disposal or failure. */
  inputBytes?(): number;
  retainedBytes?(): number;
  outputBytes?(): number;
  accounting(): Readonly<FoldAccounting>;
}
export function createFoldEngine(options: FoldOptions, locale: string, configuration: Partial<FoldLimits> = {}, signal?: AbortSignal): FoldEngine {
  const limits = { ...defaultFoldLimits, ...configuration };
  validateLimits(limits);
  if (locale !== 'C' && locale !== 'UTF-8/Unicode-17.0.0') throw new FoldError('LOCALE', `Unavailable locale profile: ${locale}`);
  if (!Number.isSafeInteger(options.width) || options.width < 1) throw new FoldError('WIDTH', 'Width must be a positive safe integer');
  if (!['columns', 'characters', 'bytes'].includes(options.mode) || typeof options.spaces !== 'boolean') throw new FoldError('OPTION', 'Invalid engine options');
  // Snapshot borrowed configuration before allocating invocation state.
  const { width, mode, spaces } = options;
  const { inputBytes, outputBytes, work } = limits;
  const decodedLimit = limits.decodedBytes ?? Infinity;
  const line = new Uint8Array(8192), pending: number[] = [];
  let used = 0, column = 0, lastWidth = 0, input = 0, decoded = 0, output = 0, steps = 0, closed = false;
  // One byte offset identifies the last candidate; no per-glyph retained objects.
  let lastBlank = 0, peakRetained = 0;
  let emitted: Uint8Array[] = [];
  let aborted = Boolean(signal?.aborted);
  const pollSignal = Boolean(signal && typeof signal.addEventListener !== "function");
  if (signal && !aborted && !pollSignal) {
    signal.addEventListener("abort", () => { aborted = true; }, { once: true });
  }
  const check = (amount = 1): void => {
    if (closed) throw new FoldError('CLOSED', 'Fold engine is closed');
    if (aborted || (pollSignal && signal!.aborted)) throw new FoldError('CANCELLED', 'Fold invocation cancelled');
    if (amount > work - steps) throw new FoldError('LIMIT', 'Algorithm work limit exceeded');
    steps += amount;
  };
  const adjust = (unit: FoldUnit, rescan = false): number => {
    check();
    if (unit.valid && unit.length === 1) {
      const cp = unit.cp;
      if (cp >= 32 && cp < 127) {
        lastWidth = 1;
        const nextCol = column + 1;
        if ((nextCol | 0) !== nextCol && !Number.isSafeInteger(nextCol)) throw new FoldError('ARITHMETIC', 'Column addition exceeds safe integer arithmetic');
        return nextCol;
      }
      if (cp === 9) {
        const nextCol = mode === 'bytes' ? column + 1 : column + (8 - (column % 8));
        if ((nextCol | 0) !== nextCol && !Number.isSafeInteger(nextCol)) throw new FoldError('ARITHMETIC', 'Column addition exceeds safe integer arithmetic');
        return nextCol;
      }
    }
    // mbbuf input errors have invalid width; mcel remainder scans use ch=0.
    // A malformed byte must never inherit the Unicode width of its byte value.
    const next = adjustFoldColumn({ column, lastWidth }, { codePoint: unit.valid ? unit.cp : rescan ? 0 : 1, byteLength: unit.length }, mode, locale);
    lastWidth = next.lastWidth;
    return next.column;
  };
  const emit = (length: number, lf: boolean): void => {
    check();
    const size = length + Number(lf);
    if (size > outputBytes - output) throw new FoldError('LIMIT', 'Output byte limit exceeded');
    check(size); // Admit allocation and byte copy before producing owned output.
    output += size;
    if (!size) return;
    const bytes = new Uint8Array(size); bytes.set(line.subarray(0, length));
    if (lf) bytes[length] = 10;
    emitted.push(bytes);
  };
  const scan = (offset: number): FoldUnit => locale === 'C' ? { cp: line[offset]!, length: 1, valid: line[offset]! < 128 } : decodeFoldUnit(line, offset, used - offset, true)!;
  const blank = (cp: number): boolean => cp === 9 || cp === 32 || (locale !== 'C' && (cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a && cp !== 0x2007) || cp === 0x205f || cp === 0x3000));
  const consume = (unit: FoldUnit, bytes: ArrayLike<number>): void => {
    check();
    if (unit.cp === 10) { emit(used, true); used = column = lastBlank = 0; return; }
    for (;;) {
      column = adjust(unit);
      if (column <= width) break;
      const boundary = spaces ? lastBlank : 0;
      if (boundary) {
        emit(boundary, true); check(used - boundary); line.copyWithin(0, boundary, used); used -= boundary; column = lastBlank = 0;
        for (let i = 0; i < used;) { const retained = scan(i); check(retained.length); column = adjust(retained, true); i += retained.length; }
      } else {
        if (!used) break; // A too-wide unit must be consumed once.
        emit(used, true); used = column = lastBlank = 0;
      }
    }
    if (used + unit.length >= line.length) { emit(used, false); used = lastBlank = 0; }
    check(unit.length);
    for (let i = 0; i < unit.length; i++) line[used++] = bytes[i]!;
    if (spaces && unit.valid && blank(unit.cp)) lastBlank = used;
  };
  const drain = (eof: boolean): void => {
    while (pending.length) {
      const unit = locale === 'C' ? { cp: pending[0]!, length: 1, valid: pending[0]! < 128 } : decodeFoldUnit(pending, 0, pending.length, eof);
      if (!unit) break;
      if (unit.length > decodedLimit - decoded) throw new FoldError('LIMIT', 'Decoded byte limit exceeded');
      check(unit.length);
      decoded += unit.length;
      consume(unit, pending);
      peakRetained = Math.max(peakRetained, used + pending.length);
      pending.splice(0, unit.length);
    }
  };
  const dispose = (): void => { closed = true; used = lastBlank = 0; pending.length = 0; emitted = []; line.fill(0); };
  const singleByte = [0];
  return {
    push(bytes) {
      try {
        check(); emitted = [];
        if (byteType.call(bytes) !== 'Uint8Array') throw new FoldError('INPUT', 'Input must be a Uint8Array byte view');
        let values: IterableIterator<number>;
        try { values = byteValues.call(bytes); }
        catch { throw new FoldError('INPUT', 'Input byte storage is unavailable'); }
        const length = byteLength.call(bytes) as number;
        if (length > (limits.chunkBytes ?? Infinity) || length > inputBytes - input) throw new FoldError('LIMIT', 'Input byte or bounded-call limit exceeded');
        input += length;
        for (const b of values) {
          if (
            pending.length === 0 &&
            b >= 32 &&
            b < 127 &&
            column < width &&
            used + 1 < line.length &&
            1 <= decodedLimit - decoded &&
            5 <= work - steps &&
            !closed &&
            !aborted &&
            !(pollSignal && signal!.aborted)
          ) {
            steps += 5;
            decoded += 1;
            column += 1;
            lastWidth = 1;
            line[used++] = b;
            if (spaces && b === 32) lastBlank = used;
            if (used > peakRetained) peakRetained = used;
            continue;
          }
          check();
          if (pending.length === 0 && b < 128) {
            if (used + 1 > peakRetained) peakRetained = used + 1;
            if (1 > decodedLimit - decoded) throw new FoldError('LIMIT', 'Decoded byte limit exceeded');
            check(1);
            decoded += 1;
            singleByte[0] = b;
            consume(ASCII_UNITS[b]!, singleByte);
            if (used > peakRetained) peakRetained = used;
          } else {
            pending.push(b);
            if (used + pending.length > peakRetained) peakRetained = used + pending.length;
            drain(false);
          }
        }
        return emitted;
      } catch (error) { dispose(); throw error; }
    },
    endFile() {
      try { check(); emitted = []; drain(true); emit(used, false); used = column = lastBlank = 0; return emitted; }
      catch (error) { dispose(); throw error; }
    },
    dispose,
    inputBytes: () => input,
    retainedBytes: () => used + pending.length,
    outputBytes: () => output,
    accounting: () => Object.freeze({ inputBytes: input, decodedBytes: decoded, retainedBytes: used + pending.length, peakRetainedBytes: peakRetained, outputBytes: output, work: steps }),
  };
}
