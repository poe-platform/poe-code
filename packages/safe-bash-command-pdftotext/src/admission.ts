export interface AdmissionLimits {
  readonly inputBytes: number;
  readonly decodedBytes: number;
  readonly retainedBytes: number;
  readonly work: number;
}

export interface AdmissionAccounting extends AdmissionLimits {
  readonly outputBytes: 0;
  readonly peakRetainedBytes: number;
}

export class PdftotextAdmissionError extends Error {
  readonly exitCode = 99;
}

const numericOptions = new Map([
  ['-f', 'firstPage'], ['-l', 'lastPage'], ['-r', 'resolution'],
  ['-x', 'x'], ['-y', 'y'], ['-W', 'width'], ['-H', 'height'],
  ['-fixed', 'fixedPitch'], ['-colspacing', 'colSpacing'],
] as const);
const flagOptions = new Map([
  ['-layout', 'layout'], ['-raw', 'raw'], ['-nodiag', 'noDiagonal'],
  ['-htmlmeta', 'htmlMeta'], ['-tsv', 'tsv'], ['-listenc', 'listEnc'],
  ['-nopgbrk', 'noPageBreaks'], ['-urls', 'urls'], ['-bbox', 'bbox'],
  ['-bbox-layout', 'bboxLayout'], ['-cropbox', 'cropBox'], ['-q', 'quiet'],
  ['-v', 'version'], ['-h', 'help'], ['-help', 'help'], ['--help', 'help'], ['-?', 'help'],
] as const);
type NumericKey = typeof numericOptions extends Map<string, infer Key> ? Key : never;
type FlagKey = typeof flagOptions extends Map<string, infer Key> ? Key : never;

export interface PdftotextArguments {
  readonly numbers: Readonly<Record<NumericKey, number>>;
  readonly flags: Readonly<Record<FlagKey, boolean>>;
  readonly files: readonly string[];
  readonly encoding: string;
  readonly eol: 'unix' | 'dos' | 'mac';
  /** Validation is deferred until initialization, after help/listenc handling. */
  readonly removeHyphens: string;
  /** Exact CLI byte truncation; these may end in an incomplete UTF-8 sequence. */
  readonly userPassword: Uint8Array;
  readonly ownerPassword: Uint8Array;
  readonly format: 'text' | 'html' | 'tsv' | 'html-tsv' | 'bbox';
  readonly order: 'logical' | 'physical' | 'raw';
  /** Direct diagnostics must be emitted even when quiet is set. */
  readonly diagnostics: readonly string[];
  readonly accounting: Readonly<AdmissionAccounting>;
}

function checkedNumber(value: string, integer: boolean): number {
  let offset = value[0] === '+' || value[0] === '-' ? 1 : 0;
  let digits = 0, dot = false;
  for (; offset < value.length; offset++) {
    const code = value.charCodeAt(offset);
    if (code >= 48 && code <= 57) digits++;
    else if (!integer && !dot && code === 46) dot = true;
    else throw new PdftotextAdmissionError('Complete decimal numeric value required');
  }
  const number = Number(value);
  if (!digits || !Number.isFinite(number) || (integer && !Number.isSafeInteger(number))) {
    throw new PdftotextAdmissionError('Finite checked numeric value required');
  }
  return number;
}

/** Pure pre-parser admission. This is not a PDF extractor or CommandDefinition. */
export function parsePdftotextArguments(args: readonly string[], signal: AbortSignal, overrides: Partial<AdmissionLimits> = {}): PdftotextArguments {
  signal.throwIfAborted();
  if (!Array.isArray(args)) throw new PdftotextAdmissionError('Arguments must be an array');
  const limits = { inputBytes: 65_536, decodedBytes: 131_072, retainedBytes: 524_288, work: 1_048_576, ...overrides };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new PdftotextAdmissionError('Limits must be nonnegative checked integers');
  }
  let inputBytes = 0, decodedBytes = 0, work = 1;
  // Fixed structures, result arrays, password storage and conservative UTF-8
  // encoder temporaries are reserved before parsing or encoding any values.
  let retainedBytes = 1024;
  if (args.length > limits.inputBytes || args.length + work > limits.work || retainedBytes > limits.retainedBytes) {
    throw new PdftotextAdmissionError('Argument admission limit exceeded');
  }
  const admitted: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    signal.throwIfAborted();
    if (typeof arg !== 'string') throw new PdftotextAdmissionError('Arguments must be strings');
    if (arg.length > limits.inputBytes - inputBytes || arg.length * 16 + 1 > limits.work - work) {
      throw new PdftotextAdmissionError('Argument byte/work limit exceeded');
    }
    decodedBytes += arg.length * 2;
    retainedBytes += arg.length * 5 + 16;
    work += arg.length * 16 + 1;
    if (decodedBytes > limits.decodedBytes || retainedBytes > limits.retainedBytes) {
      throw new PdftotextAdmissionError('Argument decode/retention limit exceeded');
    }
    inputBytes++;
    for (let i = 0; i < arg.length; i++) {
      signal.throwIfAborted();
      const code = arg.charCodeAt(i);
      if (!code) throw new PdftotextAdmissionError('NUL is unavailable in admitted arguments');
      if (code >= 0xd800 && code <= 0xdbff) {
        const low = arg.charCodeAt(++i);
        if (!(low >= 0xdc00 && low <= 0xdfff)) throw new PdftotextAdmissionError('Malformed Unicode argument');
        inputBytes += 4;
      } else if (code >= 0xdc00 && code <= 0xdfff) throw new PdftotextAdmissionError('Malformed Unicode argument');
      else inputBytes += code < 128 ? 1 : code < 2048 ? 2 : 3;
      if (inputBytes > limits.inputBytes) throw new PdftotextAdmissionError('Argument byte limit exceeded');
    }
    if (inputBytes > limits.inputBytes) throw new PdftotextAdmissionError('Argument byte limit exceeded');
    admitted.push(arg);
  }
  const numbers: Record<NumericKey, number> = { firstPage: 1, lastPage: 0, resolution: 72, x: 0, y: 0, width: 0, height: 0, fixedPitch: 0, colSpacing: 0.7 };
  const flags: Record<FlagKey, boolean> = { layout: false, raw: false, noDiagonal: false, htmlMeta: false, tsv: false, listEnc: false, noPageBreaks: false, urls: false, bbox: false, bboxLayout: false, cropBox: false, quiet: false, version: false, help: false };
  const files: string[] = [], diagnostics: string[] = [];
  let encoding = 'UTF-8', eolValue = 'unix', removeHyphens = 'all';
  let userPassword = new Uint8Array(0), ownerPassword = new Uint8Array(0), ended = false;
  const asciiValue = (value: string, length: number): string => {
    // Encoding/profile identifiers are ASCII; raw non-ASCII argv profiles are
    // not qualified by this string admission API.
    for (let i = 0; i < value.length; i++) {
      if (value.charCodeAt(i) > 127) throw new PdftotextAdmissionError('Profile identifiers must be ASCII');
    }
    return value.slice(0, length);
  };
  for (let index = 0; index < admitted.length; index++) {
    signal.throwIfAborted();
    const arg = admitted[index]!;
    if (ended) { files.push(arg); continue; }
    if (arg === '--') { ended = true; continue; }
    const numeric = numericOptions.get(arg as Parameters<typeof numericOptions.get>[0]);
    const flag = flagOptions.get(arg as Parameters<typeof flagOptions.get>[0]);
    if (flag) { flags[flag] = true; continue; }
    if (numeric || ['-enc', '-eol', '-remove-hyphens', '-opw', '-upw'].includes(arg)) {
      const value = admitted[++index];
      if (value === undefined) throw new PdftotextAdmissionError(`Missing operand for ${arg}`);
      if (numeric) {
        numbers[numeric] = checkedNumber(value, !['resolution', 'fixedPitch', 'colSpacing'].includes(numeric));
        if (numeric === 'resolution' && numbers.resolution <= 0) throw new PdftotextAdmissionError('Resolution must be positive');
      } else if (arg === '-enc') encoding = asciiValue(value, 127);
      else if (arg === '-eol') eolValue = asciiValue(value, 15);
      else if (arg === '-remove-hyphens') removeHyphens = asciiValue(value, 15);
      else {
        const password = new TextEncoder().encode(value).slice(0, 32);
        if (arg === '-upw') userPassword = password; else ownerPassword = password;
      }
    } else {
      // Native leaves unknown tokens positional. This profile requires deliberate
      // path admission via --, ./ or / instead of treating misspelled flags as files.
      if (arg !== '-' && arg.startsWith('-')) throw new PdftotextAdmissionError('Unknown option: ' + arg);
      files.push(arg);
    }
  }
  if (flags.bboxLayout) flags.bbox = true;
  if (flags.bbox) flags.htmlMeta = true;
  if (numbers.colSpacing <= 0 || numbers.colSpacing > 10) throw new PdftotextAdmissionError('Column spacing must be in (0, 10]');
  if (flags.urls && (flags.htmlMeta || flags.tsv)) throw new PdftotextAdmissionError('URLs are unavailable with HTML or TSV');
  let eol: PdftotextArguments['eol'] = 'unix';
  if (eolValue === 'unix' || eolValue === 'dos' || eolValue === 'mac') eol = eolValue;
  else diagnostics.push("Bad '-eol' value on command line\n");
  return Object.freeze({
    numbers: Object.freeze(numbers), flags: Object.freeze(flags), files: Object.freeze(files),
    encoding, eol, removeHyphens, userPassword, ownerPassword,
    format: flags.bbox ? 'bbox' : flags.tsv ? flags.htmlMeta ? 'html-tsv' : 'tsv' : flags.htmlMeta ? 'html' : 'text',
    order: flags.raw ? 'raw' : flags.layout || numbers.fixedPitch !== 0 ? 'physical' : 'logical',
    diagnostics: Object.freeze(diagnostics),
    accounting: Object.freeze({ inputBytes, decodedBytes, retainedBytes, peakRetainedBytes: retainedBytes, outputBytes: 0, work }),
  });
}
