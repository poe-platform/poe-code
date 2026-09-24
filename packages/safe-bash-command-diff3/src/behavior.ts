import { Diff3Error, type Diff3Accounting, type Diff3Limits, type Diff3Line, type Diff3Range } from './contracts.js';
import { createDiff3Engine } from './engine.js';
import { bodyLength } from './comparison.js';
import { byteView } from './bytes.js';

export type Diff3Selector = 'A' | 'e' | 'E' | 'x' | 'X' | '3';
export interface Diff3BehaviorLimits extends Diff3Limits {
  readonly outputBytes: number;
  readonly argumentBytes: number;
  readonly decodedBytes: number;
  readonly labelBytes: number;
}
export interface Diff3Invocation {
  readonly files: readonly string[];
  readonly labels?: readonly string[];
  readonly selector?: Diff3Selector;
  readonly merge?: boolean;
  readonly writeQuit?: boolean;
  readonly initialTab?: boolean;
  readonly text?: boolean;
  readonly stripTrailingCR?: boolean;
  readonly information?: 'help' | 'version';
}
export const diff3DefaultLimits: Diff3BehaviorLimits = Object.freeze({ inputBytes: Infinity, retainedBytes: Infinity, tokens: Infinity, graphCells: Infinity, work: Infinity, outputBytes: Infinity, argumentBytes: Infinity, decodedBytes: Infinity, labelBytes: Infinity });
export interface Diff3BehaviorResult {
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly exitCode: 0 | 1;
  readonly accounting: Diff3Accounting & { readonly outputBytes: number; readonly decodedBytes: number };
}
function optionError(message: string): never { throw new Diff3Error('STATE', message); }
function checkedLimits(limits: Diff3BehaviorLimits): void {
  for (const key of Object.keys(diff3DefaultLimits) as (keyof Diff3BehaviorLimits)[]) if (limits[key] !== Infinity && (!Number.isSafeInteger(limits[key]) || limits[key] < 0)) throw new Diff3Error('LIMIT', `Invalid ${key} limit: expected a nonnegative safe integer`);
}
/** Validate and snapshot SDK options too; paths and labels are Unicode VFS metadata. */
export function validateDiff3Invocation(options: Diff3Invocation, limits: Diff3BehaviorLimits): Diff3Invocation {
  checkedLimits(limits);
  const sourceFiles = options.files, sourceLabels = options.labels ?? [];
  if (!Array.isArray(sourceFiles) || !Array.isArray(sourceLabels)) optionError('Files and labels must be arrays');
  const fileCount = sourceFiles.length, labelCount = sourceLabels.length;
  const descriptors = fileCount + labelCount;
  if (descriptors > limits.argumentBytes || descriptors * 8 > limits.retainedBytes || descriptors > limits.graphCells || descriptors * 4 > limits.work) throw new Diff3Error('LIMIT', 'Metadata descriptor limit exceeded');
  if (options.information !== undefined && options.information !== 'help' && options.information !== 'version') optionError('Unsupported information mode');
  for (const flag of ['merge', 'writeQuit', 'initialTab', 'text', 'stripTrailingCR'] as const) if (options[flag] !== undefined && typeof options[flag] !== 'boolean') optionError('Flags must be booleans');
  if (!options.information && fileCount !== 3) optionError('Exactly three operands are required');
  if (labelCount > 3) optionError('Too many file labels');
  let argumentsSize = 0, decoded = 0, labelsSize = 0;
  const copy = (value: string, label: boolean): string => {
    if (typeof value !== 'string') optionError('Paths and labels must be strings');
    if (value.length > limits.argumentBytes - argumentsSize) throw new Diff3Error('LIMIT', 'Argument byte limit exceeded');
    if (value.length * 2 > limits.decodedBytes - decoded || value.length * 5 > limits.retainedBytes || value.length * 4 > limits.work) throw new Diff3Error('LIMIT', 'Metadata allocation limit exceeded');
    if (value.includes('\0')) optionError('Paths and labels must be NUL-free strings');
    // TextEncoder replaces lone surrogates; refuse metadata that cannot round-trip.
    for (let i = 0; i < value.length; i++) {
      const unit = value.charCodeAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) optionError('Paths and labels must be valid UTF-8 metadata');
      } else if (unit >= 0xdc00 && unit <= 0xdfff) optionError('Paths and labels must be valid UTF-8 metadata');
    }
    const size = new TextEncoder().encode(value).length;
    argumentsSize += size + 1; decoded += value.length * 2;
    if (label) labelsSize += size;
    if (argumentsSize > limits.argumentBytes || decoded > limits.decodedBytes || labelsSize > limits.labelBytes || decoded + argumentsSize + descriptors * 8 > limits.retainedBytes || argumentsSize * 4 > limits.work) throw new Diff3Error('LIMIT', 'Invocation metadata limit exceeded');
    return value;
  };
  const files: string[] = [], labels: string[] = [];
  for (let i = 0; i < fileCount; i++) files.push(copy(sourceFiles[i]!, false));
  for (let i = 0; i < labelCount; i++) labels.push(copy(sourceLabels[i]!, true));
  if (sourceFiles.length !== fileCount || sourceLabels.length !== labelCount) optionError('Metadata changed during admission');
  const selector = options.selector ?? (options.merge ? 'A' : undefined);
  if (selector !== undefined && !['A', 'e', 'E', '3', 'x', 'X'].includes(selector)) optionError('Unsupported script selector');
  if (options.merge && options.writeQuit) optionError('Incompatible options: merge and write/quit');
  if (labels.length > 3) optionError('Too many file labels');
  if (labels.length && selector !== 'A' && selector !== 'E') optionError('Labels require a flagging mode');
  if (!options.information && files.length !== 3) optionError('Exactly three operands are required');
  if (files.filter(file => file === '-').length > 1) optionError('Multiple stdin operands are unavailable');
  const effectiveLabels = files.map((file, index) => labels[index] ?? file);
  if (!options.merge && (selector === 'A' || selector === 'E') && effectiveLabels.some(label => label.includes('\n') || label.includes('\r'))) optionError('Ed labels must be single-line');
  return Object.freeze({ files: Object.freeze(files), labels: Object.freeze(labels), merge: options.merge === true, writeQuit: options.writeQuit === true, initialTab: options.initialTab === true, text: options.text === true, stripTrailingCR: options.stripTrailingCR === true, ...(selector ? { selector } : {}), ...(options.information ? { information: options.information } : {}) });
}
const longOptions: Readonly<Record<string, string>> = Object.freeze({ 'diff-program': 'external', 'easy-only': '3', ed: 'e', help: 'help', 'initial-tab': 'T', label: 'L', merge: 'm', 'overlap-only': 'x', 'show-all': 'A', 'show-overlap': 'E', 'strip-trailing-cr': 'cr', text: 'a', version: 'version' });
export function parseDiff3Arguments(args: readonly string[], limits: Diff3BehaviorLimits = diff3DefaultLimits): Diff3Invocation {
  checkedLimits(limits);
  let size = 0;
  for (const arg of args) {
    if (arg.length > limits.argumentBytes - size) throw new Diff3Error('LIMIT', 'Argument byte limit exceeded');
    if (arg.length * 5 + 8 > limits.retainedBytes || arg.length * 4 > limits.work) throw new Diff3Error('LIMIT', 'Parser allocation limit exceeded');
    size += new TextEncoder().encode(arg).length + 1;
    if (size > limits.argumentBytes || size * 4 > limits.work || size * 3 > limits.retainedBytes || size * 2 > limits.decodedBytes) throw new Diff3Error('LIMIT', 'Parser resource limit exceeded');
  }
  const files: string[] = [], labels: string[] = [];
  let selector: Diff3Selector | undefined, merge = false, writeQuit = false, initialTab = false, text = false, stripTrailingCR = false, information: 'help' | 'version' | undefined, ended = false;
  const flag = (name: string, value?: string): void => {
    if (['A', 'e', 'E', '3', 'x', 'X'].includes(name)) {
      if (selector && selector !== name) optionError('Incompatible script selectors');
      selector = name as Diff3Selector;
    } else if (name === 'm') merge = true;
    else if (name === 'i') writeQuit = true;
    else if (name === 'T') initialTab = true;
    else if (name === 'a') text = true;
    else if (name === 'cr') stripTrailingCR = true;
    else if (name === 'L') { if (value === undefined) optionError('Label requires a value'); labels.push(value); }
    else if (name === 'help' || name === 'version' || name === 'v') information = name === 'help' ? 'help' : 'version';
    else if (name === 'external') optionError('External diff programs are unavailable');
    else optionError('Unsupported option');
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (!ended && arg === '--') { ended = true; continue; }
    if (ended || !arg.startsWith('-') || arg === '-') { files.push(arg); continue; }
    if (arg.startsWith('--')) {
      const equal = arg.indexOf('=');
      const name = arg.slice(2, equal < 0 ? undefined : equal);
      const matches = Object.keys(longOptions).filter(key => key.startsWith(name));
      const key = Object.hasOwn(longOptions, name) ? name : matches.length === 1 ? matches[0]! : optionError('Unknown or ambiguous long option');
      const target = longOptions[key]!;
      if (target !== 'L' && target !== 'external' && equal >= 0) optionError('Option does not accept a value');
      flag(target, target === 'L' ? equal < 0 ? args[++index] : arg.slice(equal + 1) : undefined);
    } else {
      for (let offset = 1; offset < arg.length; offset++) {
        const name = arg[offset]!;
        if (name === 'L') { flag(name, offset + 1 < arg.length ? arg.slice(offset + 1) : args[++index]); break; }
        flag(name);
      }
    }
  }
  return validateDiff3Invocation({ files, labels, ...(selector ? { selector } : {}), merge, writeQuit, initialTab, text, stripTrailingCR, ...(information ? { information } : {}) }, limits);
}

/** Byte report/merge/script API. No interpreter or filesystem capabilities. */
export function compareDiff3(inputs: readonly Uint8Array[], invocation: Diff3Invocation, limits: Diff3BehaviorLimits = diff3DefaultLimits, signal?: AbortSignal): Diff3BehaviorResult {
  signal?.throwIfAborted();
  const options = validateDiff3Invocation(invocation, limits);
  let work = 0, retained = 0, output = 0, decodedBytes = 0, peakRetainedBytes = 0, peakGraphCells = 0, graphCells = 0, sourceInput = 0;
  const charge = (amount: number): void => {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(amount) || amount > limits.work - work) throw new Diff3Error('LIMIT', 'Rendering work limit exceeded');
    work += amount;
  };
  const hold = (amount: number): void => {
    if (!Number.isSafeInteger(amount) || amount > limits.retainedBytes - retained) throw new Diff3Error('LIMIT', 'Rendering retention limit exceeded');
    retained += amount; peakRetainedBytes = Math.max(peakRetainedBytes, retained);
  };
  const out: Uint8Array[] = [], err: Uint8Array[] = [];
  const graph = (amount: number): void => {
    if (!Number.isSafeInteger(amount) || amount > limits.graphCells - graphCells) throw new Diff3Error('LIMIT', 'Rendering graph limit exceeded');
    graphCells += amount; peakGraphCells = Math.max(peakGraphCells, graphCells);
  };
  for (const value of [...options.files, ...(options.labels ?? [])]) {
    decodedBytes += value.length * 2; hold(value.length * 2 + 8); charge(value.length * 4 + 1); graph(1);
  }
  const accounting = (): Diff3BehaviorResult['accounting'] => ({ inputBytes: sourceInput, outputBytes: output, decodedBytes, retainedBytes: 0, peakRetainedBytes, tokens: 0, graphCells: 0, peakGraphCells, work });
  const emit = (bytes: Uint8Array, destination = out): void => {
    charge(bytes.length + 1);
    if (bytes.length > limits.outputBytes - output) throw new Diff3Error('LIMIT', 'Output byte limit exceeded');
    output += bytes.length; hold(bytes.length + 8); graph(1);
    destination.push(new Uint8Array(bytes));
  };
  const literal = (value: string, destination = out): void => {
    // Admit encoder storage before allocating; literal metadata is bounded.
    hold(value.length * 3); charge(value.length * 4);
    emit(new TextEncoder().encode(value), destination); retained -= value.length * 3;
  };
  if (options.information) {
    literal(options.information === 'version' ? 'diff3 (safe-bash; GNU diffutils 3.12 qualified profile)\n' : 'Usage: diff3 [OPTION]... OURS BASE THEIRS\nReports, -m merge, -A/-e/-E/-3/-x/-X ed scripts; -a -T -L -i --strip-trailing-cr.\nNo external diff/ed programs. One stdin operand in any position. Ed labels must be single-line.\n');
  } else {
    if (inputs.length !== 3) optionError('Exactly three byte inputs are required');
    const views: Uint8Array[] = [];
    for (let i = 0; i < 3; i++) views.push(byteView(inputs[i]!));
    inputs = views;
    let inputSize = 0;
    for (const input of inputs) { charge(input.length); inputSize += input.length; }
    if (inputSize > limits.inputBytes) throw new Diff3Error('LIMIT', 'Input byte limit exceeded');
    sourceInput = inputSize;
    const report = !options.selector && !options.merge;
    const preferredCommon = report ? 2 : 1;
    const common = options.files[preferredCommon] === '-' ? 3 - preferredCommon : preferredCommon;
    const other = 3 - common;
    // Identical binary inputs are accepted by GNU without text mode.
    let identical = true;
    for (const input of inputs.slice(1)) {
      if (input.length !== inputs[0]!.length) { identical = false; break; }
      for (let i = 0; i < input.length; i++) { charge(1); if (input[i] !== inputs[0]![i]) { identical = false; break; } }
      if (!identical) break;
    }
    const engine = createDiff3Engine({ ...limits, work: limits.work - work, retainedBytes: limits.retainedBytes - retained, graphCells: limits.graphCells - graphCells }, { text: options.text === true || identical, stripTrailingCR: options.stripTrailingCR === true }, signal);
    let analysis;
    try {
      for (const [file, index] of [['base', common], ['left', 0], ['right', other]] as const) { engine.push(file, inputs[index]!); engine.end(file); }
      analysis = engine.finish(); work += engine.accounting().work;
      peakRetainedBytes = Math.max(peakRetainedBytes, retained + engine.accounting().peakRetainedBytes);
      peakGraphCells = Math.max(peakGraphCells, graphCells + engine.accounting().peakGraphCells);
    } finally { engine.dispose(); }
    hold(inputSize);
    graph((analysis.leftEdits.length + analysis.rightEdits.length) * 4 + analysis.regions.length * 7);
    const files: (readonly Diff3Line[])[] = [];
    files[0] = analysis.files.left; files[other] = analysis.files.right; files[common] = analysis.files.base;
    const labels = options.files.map((file, i) => options.labels?.[i] ?? file);
    const line = (token: Diff3Line, mode: 'source' | 'changed' | 'report' | 'ed'): void => {
      const length = mode === 'source' ? token.bytes.length : bodyLength(token, options) + Number(token.terminated);
      const cr = mode !== 'source' && options.stripTrailingCR === true && length !== token.bytes.length;
      const body = token.bytes.subarray(0, length - Number(cr));
      emit(body);
      if (cr) emit(Uint8Array.of(10));
      if (!token.terminated && (mode === 'ed' || mode === 'report')) literal('\n');
      if (!token.terminated && mode === 'report') literal('\\ No newline at end of file\n');
    };
    const range = (file: number, address: Diff3Range, mode: 'source' | 'changed' | 'report' | 'ed'): boolean => {
      let dots = false;
      for (let i = address.start; i < address.end; i++) {
        charge(1); const token = files[file]![i]!;
        if (mode === 'report') literal(options.initialTab ? '\t' : '  ');
        if (mode === 'ed' && token.bytes[0] === 46) { literal('.'); dots = true; }
        line(token, mode);
      }
      return dots;
    };
    const address = (r: Diff3Range): string => r.start === r.end ? `${r.start}a` : `${r.start + 1}${r.end > r.start + 1 ? `,${r.end}` : ''}c`;
    let conflict = false;
    if (!report && !options.merge) {
      // Pairwise protocol warns for each changed unterminated endpoint.
      for (const edits of [analysis.leftEdits, analysis.rightEdits]) for (const edit of edits) {
        const variant = edits === analysis.leftEdits ? analysis.files.left : analysis.files.right;
        for (const [tokens, r] of [[analysis.files.base, edit.base], [variant, edit.variant]] as const) {
          if (r.end > r.start && !tokens[r.end - 1]!.terminated) literal('diff3: No newline at end of file\n', err);
        }
      }
    }
    let cursor = 0;
    if (!options.merge && !report) { graph(analysis.regions.length); hold(analysis.regions.length * 8); charge(analysis.regions.length); }
    const regions = options.merge || report ? analysis.regions : [...analysis.regions].reverse();
    for (const region of regions) {
      charge(1);
      const ranges: Diff3Range[] = [];
      ranges[0] = region.left; ranges[other] = region.right; ranges[common] = region.base;
      const base = ranges[1]!, theirs = ranges[2]!;
      const different = region.kind === 'left' ? 1 : region.kind === 'right' ? other + 1 : region.kind === 'identical' ? common + 1 : 0;
      if (report) {
        literal(`====${different || ''}\n`);
        const sequence = different === 2 ? [0, 2, 1] : [0, 1, 2];
        for (let i = 0; i < sequence.length; i++) {
          const file = sequence[i]!;
          literal(`${file + 1}:${address(ranges[file]!)}\n`);
          if (different === 0 || file === different - 1 || i === 1 && different !== 1 || i === 2 && different === 1) range(file, ranges[file]!, 'report');
        }
        continue;
      }
      const selector = options.selector!;
      const flagged = different === 0 && (selector === 'A' || selector === 'E') || different === 2 && selector === 'A';
      const replace = different === 3 && ['A', 'E', 'e', '3'].includes(selector) || different === 0 && ['e', 'x', 'X'].includes(selector);
      if (options.merge) {
        range(0, { start: cursor, end: region.left.start }, 'source');
        if (flagged) {
          conflict = true;
          if (different === 2) { literal(`<<<<<<< ${labels[1]}\n`); range(1, base, 'changed'); }
          else { literal(`<<<<<<< ${labels[0]}\n`); range(0, region.left, 'changed'); if (selector === 'A') { literal(`||||||| ${labels[1]}\n`); range(1, base, 'changed'); } }
          literal('=======\n'); range(2, theirs, 'changed'); literal(`>>>>>>> ${labels[2]}\n`);
        } else range(replace ? 2 : 0, replace ? theirs : region.left, replace ? 'changed' : 'source');
        cursor = region.left.end;
      } else if (replace) {
        if (theirs.start === theirs.end) { if (region.left.start !== region.left.end) literal(address(region.left).slice(0, -1) + 'd\n'); }
        else {
          literal(address(region.left) + '\n');
          const dots = range(2, theirs, 'ed'); literal('.\n');
          if (dots) { const start = region.left.start + 1, end = region.left.start + theirs.end - theirs.start; literal(`${start}${end > start ? `,${end}` : ''}s/^\\.//\n`); }
        }
      } else if (flagged) {
        conflict = true;
        literal(`${region.left.end}a\n`);
        let dots = false;
        if (different !== 2) {
          if (selector === 'A') { literal(`||||||| ${labels[1]}\n`); dots = range(1, base, 'ed'); }
          literal('=======\n'); dots = range(2, theirs, 'ed') || dots;
        }
        literal(`>>>>>>> ${labels[2]}\n.\n`);
        if (dots) literal(`${region.left.end + 2},${region.left.end + base.end - base.start + theirs.end - theirs.start + 2}s/^\\.//\n`);
        literal(`${region.left.start}a\n<<<<<<< ${labels[different === 2 ? 1 : 0]}\n`);
        if (different === 2) { const baseDots = range(1, base, 'ed'); literal('=======\n.\n'); if (baseDots) { const start = region.left.start + 2, end = region.left.start + base.end - base.start + 1; literal(`${start}${end > start ? `,${end}` : ''}s/^\\.//\n`); } }
        else literal('.\n');
      }
    }
    if (options.merge) range(0, { start: cursor, end: files[0]!.length }, 'source');
    else if (!report && options.writeQuit) literal('w\nq\n');
    const flatten = (chunks: readonly Uint8Array[]): Uint8Array => {
      const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0); hold(size); charge(size);
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return bytes;
    };
    const stdout = flatten(out), stderr = flatten(err);
    return { stdout, stderr, exitCode: conflict ? 1 : 0, accounting: accounting() };
  }
  const size = out.reduce((sum, chunk) => sum + chunk.length, 0); hold(size); charge(size);
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of out) { bytes.set(chunk, offset); offset += chunk.length; }
  return { stdout: bytes, stderr: new Uint8Array(), exitCode: 0, accounting: accounting() };
}
