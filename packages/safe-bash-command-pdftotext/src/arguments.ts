import { PdftotextAdmissionError, type AdmissionLimits, type AdmissionAccounting } from './admission.js';

export function normalizePageRange(first: number, last: number, count: number): readonly [number, number] {
  if (![first, last, count].every(Number.isSafeInteger) || count < 1) {
    throw new PdftotextAdmissionError('Page values must be checked integers and page count must be positive');
  }
  first = Math.max(1, first);
  last = last < 1 || last > count ? count : last;
  if (first > last) throw new PdftotextAdmissionError('Wrong page range');
  return Object.freeze([first, last]);
}

export function defaultOutputName(input: string, htmlMeta: boolean, signal: AbortSignal, overrides: Partial<AdmissionLimits> = {}): { readonly name: string; readonly accounting: Readonly<AdmissionAccounting> } {
  signal.throwIfAborted();
  const limits = { inputBytes: 65_536, decodedBytes: 131_072, retainedBytes: 524_288, work: 1_048_576, ...overrides };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new PdftotextAdmissionError('Limits must be nonnegative checked integers');
  }
  // Reserve input, possible sliced stem, appended name and fixed structures.
  const decodedBytes = input.length * 2, retainedBytes = input.length * 6 + 1034, work = input.length * 8 + 1;
  if (input.length > limits.inputBytes || decodedBytes > limits.decodedBytes || retainedBytes > limits.retainedBytes || work > limits.work) {
    throw new PdftotextAdmissionError('Output path admission limit exceeded');
  }
  if (!input || input === '-') throw new PdftotextAdmissionError('Explicit output filename required');
  let inputBytes = 0;
  for (let i = 0; i < input.length; i++) {
    signal.throwIfAborted();
    const cp = input.codePointAt(i)!;
    if (!cp || (cp >= 0xd800 && cp <= 0xdfff)) throw new PdftotextAdmissionError('Invalid Unicode VFS path');
    if (cp > 0xffff) i++;
    inputBytes += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
    if (inputBytes > limits.inputBytes) throw new PdftotextAdmissionError('Output path byte limit exceeded');
  }
  const stem = input.endsWith('.pdf') || input.endsWith('.PDF') ? input.slice(0, -4) : input;
  return Object.freeze({ name: stem + (htmlMeta ? '.html' : '.txt'), accounting: Object.freeze({ inputBytes, decodedBytes, retainedBytes, peakRetainedBytes: retainedBytes, outputBytes: 0, work }) });
}
