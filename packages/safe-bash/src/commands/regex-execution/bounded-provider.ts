import { PublicDiagnostic } from "../../diagnostics.js";
import { foldAscii } from "./ascii.js";
import { yieldTurn } from "../../contracts/yield.js";
import { matchExprSteps, searchBreSteps } from "../expr/bre-engine.js";
import { EreSyntaxError, EreUnsupportedError, EreProfileLimitError, EreUsageUnknownError } from "./ere/errors.js";
import { EreLedger } from "./ere/limits.js";
import { compileEre } from "./ere/syntax.js";
import { prepareUtf8EreSubject } from "./ere/matcher.js";
import { validateUtf8 } from "./utf8.js";
import type { EreFragment, EreProgram } from "./ere/types.js";
import type { BoundedRegexProvider, RegexWorker, RegexWorkerRequest } from "./provider.js";
import { ExprMatchError, exprMatchCeilings, type BreSearchDescriptor, type BreSearchReply, type ExprMatchDescriptor, type ExprMatchLimits, type ExprMatchReply, type GrepDescriptor, type Reply, type Row, type SearchDescriptor } from "./protocol.js";

export interface BoundedRegexProviderOptions {
  readonly maxWorkers?: number;
  readonly maxPatterns?: number;
  readonly maxPatternBytes?: number;
  readonly maxRows?: number;
  readonly maxInputBytes?: number;
  readonly maxResultBytes?: number;
  readonly maxWork?: number;
  readonly maxAllocationUnits?: number;
  readonly maxStates?: number;
  readonly maxMatchesPerLine?: number;
  readonly maxTotalMatches?: number;
}

const defaults: Required<BoundedRegexProviderOptions> = Object.freeze({
  maxWorkers: 2, maxPatterns: 32, maxPatternBytes: 8192, maxRows: 128,
  maxInputBytes: 65_536, maxResultBytes: 2048, maxWork: 2_000_000,
  maxAllocationUnits: 1_000_000, maxStates: 65_536, maxMatchesPerLine: 128, maxTotalMatches: 128,
});
const ceilings: Required<BoundedRegexProviderOptions> = Object.freeze({
  maxWorkers: 32, maxPatterns: 128, maxPatternBytes: 65_532, maxRows: 4096,
  maxInputBytes: 1_048_576, maxResultBytes: 65_536, maxWork: 33_554_432,
  maxAllocationUnits: 4_000_000, maxStates: 65_536, maxMatchesPerLine: 100_000, maxTotalMatches: 100_000,
});

type SelectionDescriptor = GrepDescriptor | SearchDescriptor;
interface OwnedRequest {
  readonly id: number;
  readonly descriptor: SelectionDescriptor;
  readonly rows: readonly Row[];
  readonly ledger: EreLedger;
  readonly limits: Required<BoundedRegexProviderOptions>;
}
interface OwnedExprRequest {
  readonly id: number;
  readonly descriptor: ExprMatchDescriptor | BreSearchDescriptor;
  readonly subject: Uint8Array;
  readonly ownedUnits: number;
}
type WorkerEvent = "message" | "error" | "messageerror" | "exit";
type Listener = ((value: unknown) => void) | ((error: Error) => void) | (() => void) | ((code: number) => void);
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const byteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const byteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const byteBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;

function fail(kind: "protocol" | "unsupported" | "limit", message: string): never {
  throw new PublicDiagnostic(`bounded regex ${kind}: ${message}`);
}

function record(value: unknown, keys: readonly string[], optional: readonly string[] = []): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("protocol", "expected a data record");
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length < keys.length || ownKeys.length > keys.length + optional.length
    || ownKeys.some(key => typeof key !== "string" || !keys.includes(key) && !optional.includes(key))) fail("protocol", "unexpected data-record fields");
  for (const key of [...keys, ...optional]) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (property === undefined ? keys.includes(key) : !("value" in property)) fail("protocol", "missing field or accessor");
  }
}

function array(value: unknown, limit: number, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) fail("protocol", `${label} must be an array`);
  if (value.length > limit) fail("limit", `${label} count limit exceeded`);
  // The length bound precedes enumeration, including sparse-array admission.
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) fail("protocol", `${label} must be a dense data array`);
  for (let index = 0; index < value.length; index++) {
    const property = Object.getOwnPropertyDescriptor(value, index);
    if (!property || !("value" in property)) fail("protocol", `${label} must be a dense data array`);
  }
}

function options(input: BoundedRegexProviderOptions): Required<BoundedRegexProviderOptions> {
  const keys = Object.keys(defaults) as (keyof BoundedRegexProviderOptions)[];
  try { record(input, [], keys); }
  catch { throw new TypeError("bounded regex options require supported own data fields"); }
  const result = { ...defaults };
  for (const key of keys) {
    if (!Object.hasOwn(input, key)) continue;
    const value = input[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > ceilings[key]) throw new RangeError(`bounded regex option ${key} is outside its limit`);
    result[key] = value;
  }
  return Object.freeze(result);
}

function descriptor(value: unknown, limits: Required<BoundedRegexProviderOptions>): SelectionDescriptor {
  if (value === null || typeof value !== "object") fail("protocol", "invalid descriptor");
  const kind = Object.getOwnPropertyDescriptor(value, "kind");
  if (!kind || !("value" in kind)) fail("protocol", "invalid descriptor kind");
  if (kind.value !== "grep" && kind.value !== "rg") fail("unsupported", "only grep and fixed rg selection descriptors are supported");
  const flags = kind.value === "grep" ? ["fixed", "extended", "insensitive", "whole", "word"] : ["fixed", "whole", "word", "nullData"];
  record(value, ["kind", "patterns", ...flags, ...(kind.value === "rg" ? ["case"] : [])]);
  for (const flag of flags) if (typeof value[flag] !== "boolean") fail("protocol", `invalid ${flag} flag`);
  if (kind.value === "rg" && !["sensitive", "insensitive", "smart"].includes(value.case as string)) fail("protocol", "invalid case flag");
  if (value.word || kind.value === "rg" && value.case !== "sensitive") fail("unsupported", "word matching and rg case-insensitive selection are unsupported");
  if (kind.value === "rg" && !value.fixed) fail("unsupported", "rg regex modes are unsupported; use fixed UTF-8 patterns");
  array(value.patterns, limits.maxPatterns, "pattern");
  let bytes = 0;
  for (let index = 0; index < value.patterns.length; index++) {
    const pattern = value.patterns[index];
    if (typeof pattern !== "string") fail("protocol", "patterns must be strings");
    if (pattern.length > limits.maxPatternBytes - bytes) fail("limit", "aggregate pattern byte limit exceeded");
    bytes += pattern.length;
  }
  return value as unknown as SelectionDescriptor;
}

function admit(input: RegexWorkerRequest, limits: Required<BoundedRegexProviderOptions>, signal: AbortSignal): OwnedRequest {
  record(input, ["id", "descriptor", "rows"]);
  const selected = descriptor(input.descriptor, limits);
  array(input.rows, limits.maxRows, "row");
  if (input.rows.length > Math.floor(limits.maxResultBytes / 16)) fail("limit", "result byte limit exceeded");
  let bytes = 0;
  for (let index = 0; index < input.rows.length; index++) {
    const row = input.rows[index]!;
    record(row, ["bytes", "all", "terminated"], ["directory", "ancestors"]);
    if (!(row.bytes instanceof Uint8Array) || typeof row.all !== "boolean" || typeof row.terminated !== "boolean"
      || Object.hasOwn(row, "directory") && typeof row.directory !== "boolean"
      || Object.hasOwn(row, "ancestors") && typeof row.ancestors !== "boolean") fail("protocol", "invalid row");
    if (Object.hasOwn(row, "directory") || Object.hasOwn(row, "ancestors")) fail("unsupported", "glob row flags are unsupported");
    if (row.all && selected.kind !== "grep") fail("unsupported", "rg all-match enumeration is unsupported");
    const length = byteLength.call(row.bytes) as number;
    if (length > limits.maxInputBytes - bytes) fail("limit", "aggregate input byte limit exceeded");
    bytes += length;
  }
  const ledger = new EreLedger({ maxExpansionBytes: 1_048_576, maxExpansionFields: 8192 }, {
    patternBytes: limits.maxPatternBytes + (selected.fixed ? 0 : 4), subjectBytes: limits.maxInputBytes,
    work: limits.maxWork, allocationUnits: limits.maxAllocationUnits, states: limits.maxStates,
  });
  // Include snapshots, row/result metadata and worst-case match storage before copying.
  ledger.charge("allocationUnits", bytes + input.rows.length * 12 + selected.patterns.length * 2 + 16, signal);
  const patterns: string[] = [];
  for (let index = 0; index < selected.patterns.length; index++) patterns.push(selected.patterns[index]!);
  const ownedDescriptor: SelectionDescriptor = selected.kind === "grep"
    ? { kind: "grep", patterns, fixed: selected.fixed, extended: selected.extended, insensitive: selected.insensitive, whole: selected.whole, word: selected.word }
    : { kind: "rg", patterns, fixed: selected.fixed, case: selected.case, whole: selected.whole, word: selected.word, nullData: selected.nullData };
  const rows: Row[] = [];
  for (let index = 0; index < input.rows.length; index++) {
    const row = input.rows[index]!;
    const source = new Uint8Array(byteBuffer.call(row.bytes) as ArrayBuffer, byteOffset.call(row.bytes) as number, byteLength.call(row.bytes) as number);
    const copy = new Uint8Array(source.length);
    copy.set(source);
    rows.push({ bytes: copy, all: row.all, terminated: row.terminated });
  }
  return { id: input.id, descriptor: ownedDescriptor, rows, ledger, limits };
}

function admitExpr(input: RegexWorkerRequest, limits: Required<BoundedRegexProviderOptions>, signal: AbortSignal): OwnedExprRequest {
  signal.throwIfAborted();
  record(input, ["id", "descriptor", "rows"]);
  const selected: unknown = input.descriptor;
  record(selected, ["kind", "pattern", "profile", "limits"]);
  if (selected.kind !== "expr-match" && selected.kind !== "bre-search" || selected.profile !== "byte" && selected.profile !== "utf8-scalar") fail("protocol", "invalid expr descriptor");
  const keys = Object.keys(exprMatchCeilings) as (keyof ExprMatchLimits)[];
  record(selected.limits, keys);
  for (const key of keys) {
    const value = selected.limits[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > exprMatchCeilings[key]) fail("protocol", "invalid expr limits");
  }
  array(input.rows, 1, "expr row");
  if (input.rows.length !== 1) fail("protocol", "expr requires exactly one subject");
  const row: unknown = input.rows[0];
  record(row, ["bytes", "all", "terminated"]);
  if (!(selected.pattern instanceof Uint8Array) || !(row.bytes instanceof Uint8Array) || row.all !== false || row.terminated !== false) fail("protocol", "invalid expr pattern or subject");
  const requested = selected.limits as unknown as ExprMatchLimits;
  const allowance: ExprMatchLimits = {
    ...requested,
    maxPatternBytes: Math.min(requested.maxPatternBytes, limits.maxPatternBytes),
    maxSubjectBytes: Math.min(requested.maxSubjectBytes, limits.maxInputBytes),
    maxSteps: Math.min(requested.maxSteps, limits.maxWork),
    maxStates: Math.min(requested.maxStates, limits.maxStates),
    maxAllocatedUnits: Math.min(requested.maxAllocatedUnits, limits.maxAllocationUnits),
  };
  const patternLength = byteLength.call(selected.pattern) as number;
  const subjectLength = byteLength.call(row.bytes) as number;
  if (patternLength > allowance.maxPatternBytes) throw new ExprMatchError("limit", "bounded regex pattern byte limit exceeded");
  if (subjectLength > allowance.maxSubjectBytes) throw new ExprMatchError("limit", "bounded regex input byte limit exceeded");
  if (limits.maxResultBytes < 32) throw new ExprMatchError("limit", "bounded regex result byte limit exceeded");
  const ownedUnits = patternLength + subjectLength + 64;
  if (ownedUnits > allowance.maxSteps) throw new ExprMatchError("limit", "bounded regex work limit exceeded");
  if (ownedUnits > allowance.maxAllocatedUnits) throw new ExprMatchError("limit", "bounded regex allocation limit exceeded");
  const copy = (bytes: Uint8Array): Uint8Array => {
    const source = new Uint8Array(byteBuffer.call(bytes) as ArrayBuffer, byteOffset.call(bytes) as number, byteLength.call(bytes) as number);
    const owned = new Uint8Array(source.length);
    owned.set(source);
    return owned;
  };
  return {
    id: input.id,
    descriptor: { kind: selected.kind, pattern: copy(selected.pattern), profile: selected.profile, limits: allowance },
    subject: copy(row.bytes), ownedUnits,
  };
}

async function executeExpr(input: OwnedExprRequest, signal: AbortSignal): Promise<ExprMatchReply | BreSearchReply> {
  if (input.descriptor.kind === "bre-search") {
    const execution = searchBreSteps(input.descriptor, input.subject, { ownedUnits: input.ownedUnits });
    while (true) {
      signal.throwIfAborted();
      const step = execution.next();
      if (step.done) return { id: input.id, operation: "bre-search", result: step.value };
      await yieldTurn(signal);
    }
  }
  const execution = matchExprSteps(input.descriptor, input.subject, { asciiOnly: true, ownedUnits: input.ownedUnits });
  while (true) {
    signal.throwIfAborted();
    const step = execution.next();
    if (step.done) return { id: input.id, operation: "expr-match", result: step.value };
    await yieldTurn(signal);
  }
}

async function breFragments(pattern: string, ledger: EreLedger, signal: AbortSignal): Promise<EreFragment[]> {
  ledger.charge("allocationUnits", 1, signal);
  const fragments: EreFragment[] = [];
  let bracket = -1;
  let member = false;
  let namedClass = false;
  for (let index = 0; index < pattern.length; index++) {
    ledger.charge("work", 1, signal);
    await ledger.checkpoint(signal);
    let character = pattern[index]!;
    let literal = false;
    if (bracket >= 0) {
      if (index === bracket + 1 && character === "^") {
        // The initial complement marker is not a bracket member.
      } else if (namedClass) {
        if (character === "]" && pattern[index - 1] === ":") namedClass = false;
      } else if (character === "]" && member) bracket = -1;
      else if (character === "[" && pattern[index + 1] === ":") namedClass = true;
      if (!(index === bracket + 1 && character === "^")) member = true;
    } else if (character === "\\") {
      character = pattern[++index]!;
      ledger.charge("work", 1, signal);
      if (character === undefined || !"\\.^$[]*".includes(character)) fail("unsupported", "BRE groups, intervals, backreferences and escape extensions are unsupported; use grep -E where applicable");
      literal = true;
    } else if ("()+?{}|".includes(character)) literal = true;
    else if (character === "[") { bracket = index; member = false; }
    else if (character === "^" && index !== 0 || character === "$" && index !== pattern.length - 1) {
      fail("unsupported", "BRE anchors are supported only at record boundaries");
    } else if (character === "*" && (index === 0 || index === 1 && pattern[0] === "^")) {
      fail("unsupported", "BRE leading literal star is unsupported; use fixed matching");
    }
    ledger.charge("allocationUnits", 4, signal);
    fragments.push({ text: character, literal });
  }
  return fragments;
}


async function literalBytes(pattern: string, selected: SelectionDescriptor, ledger: EreLedger, signal: AbortSignal): Promise<Uint8Array> {
  const { kind } = selected;
  let length = 0;
  if (kind === "grep") {
    // grep transports raw pattern bytes in Latin-1 code units, not Unicode text.
    await validateUtf8(pattern, ledger, signal);
    length = pattern.length;
  } else {
    for (let index = 0; index < pattern.length;) {
      const scalar = pattern.codePointAt(index)!;
      const units = scalar > 0xffff ? 2 : 1;
      ledger.charge("work", units, signal);
      if (scalar === 0 || scalar >= 0xd800 && scalar <= 0xdfff) fail("unsupported", "rg literal patterns require non-NUL Unicode scalars for UTF-8");
      if (scalar === 10 && selected.kind === "rg" && !selected.nullData) fail("unsupported", "rg multiline matching is unsupported");
      length += scalar < 0x80 ? 1 : scalar < 0x800 ? 2 : scalar < 0x10000 ? 3 : 4;
      index += units;
      await ledger.checkpoint(signal);
    }
  }
  ledger.charge("patternBytes", length, signal);
  ledger.charge("allocationUnits", length + 1, signal);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (let index = 0; index < pattern.length;) {
    const scalar = kind === "grep" ? pattern.charCodeAt(index) : pattern.codePointAt(index)!;
    const width = kind === "grep" || scalar < 0x80 ? 1 : scalar < 0x800 ? 2 : scalar < 0x10000 ? 3 : 4;
    ledger.charge("work", width, signal);
    if (width === 1) bytes[offset++] = scalar;
    else {
      bytes[offset++] = width === 2 ? 0xc0 | scalar >> 6 : width === 3 ? 0xe0 | scalar >> 12 : 0xf0 | scalar >> 18;
      if (width === 4) bytes[offset++] = 0x80 | scalar >> 12 & 0x3f;
      if (width >= 3) bytes[offset++] = 0x80 | scalar >> 6 & 0x3f;
      bytes[offset++] = 0x80 | scalar & 0x3f;
    }
    index += kind === "rg" && scalar > 0xffff ? 2 : 1;
    await ledger.checkpoint(signal);
  }
  return bytes;
}

interface LiteralProgram { readonly bytes: Uint8Array; readonly fallback: Uint32Array; readonly insensitive: boolean }

async function compileLiteral(bytes: Uint8Array, ledger: EreLedger, signal: AbortSignal, insensitive = false): Promise<LiteralProgram> {
  if (insensitive) for (let index = 0; index < bytes.length; index++) {
    ledger.charge("work", 1, signal);
    await ledger.checkpoint(signal);
    bytes[index] = foldAscii(bytes[index]!);
  }
  ledger.charge("states", bytes.length, signal);
  ledger.charge("allocationUnits", bytes.length * 4 + 4, signal);
  const fallback = new Uint32Array(bytes.length);
  // KMP failure links bound prefix-heavy matching to linear work per pattern/row.
  for (let index = 1, prefix = 0; index < bytes.length;) {
    ledger.charge("work", 1, signal);
    if (bytes[index] === bytes[prefix]) fallback[index++] = ++prefix;
    else if (prefix > 0) prefix = fallback[prefix - 1]!;
    else index++;
    await ledger.checkpoint(signal);
  }
  return { bytes, fallback, insensitive };
}

async function literalStart(program: LiteralProgram, subject: Uint8Array, whole: boolean, ledger: EreLedger, signal: AbortSignal, from = 0): Promise<number> {
  const { bytes, fallback } = program;
  ledger.charge("work", 1, signal);
  await ledger.checkpoint(signal);
  if (whole && (from !== 0 || bytes.length !== subject.length) || bytes.length > subject.length - from) return -1;
  if (bytes.length === 0) return from;
  for (let index = from, prefix = 0; index < subject.length;) {
    ledger.charge("work", 1, signal);
    if ((program.insensitive ? foldAscii(subject[index]!) : subject[index]) === bytes[prefix]) {
      index++;
      if (++prefix === bytes.length) return index - prefix;
    } else if (prefix > 0) prefix = fallback[prefix - 1]!;
    else index++;
    await ledger.checkpoint(signal);
  }
  return -1;
}

interface Span { readonly start: number; readonly end: number }
interface MatchUsage { count: number }

async function enumerate(input: OwnedRequest, row: Row, finders: readonly ((from: number) => Promise<Span | undefined>)[], usage: MatchUsage, signal: AbortSignal): Promise<Float64Array> {
  const { ledger, limits } = input;
  ledger.charge("allocationUnits", finders.length + 2, signal);
  const cached: (Span | null | undefined)[] = new Array(finders.length);
  const ranges: number[] = [];
  for (let from = 0; from <= row.bytes.length;) {
    let best: Span | undefined;
    for (let index = 0; index < finders.length; index++) {
      ledger.charge("work", 1, signal);
      await ledger.checkpoint(signal);
      let candidate = cached[index];
      if (candidate === undefined || candidate !== null && candidate.start < from) {
        candidate = await finders[index]!(from) ?? null;
        cached[index] = candidate;
      }
      if (candidate && (!best || candidate.start < best.start || candidate.start === best.start && candidate.end > best.end)) best = candidate;
    }
    if (!best) break;
    if (ranges.length / 2 >= limits.maxMatchesPerLine) fail("limit", "matches per line limit exceeded");
    if (usage.count >= limits.maxTotalMatches) fail("limit", "total match limit exceeded");
    if (usage.count >= Math.floor(limits.maxResultBytes / 16)) fail("limit", "result byte limit exceeded");
    ledger.charge("work", 2, signal);
    // Charge temporary number pairs and the final Float64Array before retaining either.
    ledger.charge("allocationUnits", 24, signal);
    usage.count++;
    ranges.push(best.start, best.end);
    if (best.end > best.start) from = best.end;
    else {
      const byte = row.bytes[best.end];
      from = best.end + (byte === undefined || byte < 0x80 ? 1 : byte < 0xe0 ? 2 : byte < 0xf0 ? 3 : 4);
    }
  }
  ledger.charge("work", ranges.length, signal);
  await ledger.checkpoint(signal);
  return new Float64Array(ranges);
}

async function executeLiteral(input: OwnedRequest, signal: AbortSignal): Promise<Reply> {
  const { descriptor: selected, rows, ledger } = input;
  const programs: LiteralProgram[] = [];
  for (const pattern of selected.patterns) {
    programs.push(await compileLiteral(await literalBytes(pattern, selected, ledger, signal), ledger, signal, selected.kind === "grep" && selected.insensitive));
  }
  ledger.charge("allocationUnits", 3, signal);
  const results: Float64Array[] = [];
  const usage: MatchUsage = { count: 0 };
  for (const row of rows) {
    await validateUtf8(row.bytes, ledger, signal);
    if (row.all) {
      ledger.charge("allocationUnits", programs.length * 2, signal);
      const finders = programs.map(program => async (from: number): Promise<Span | undefined> => {
        const start = await literalStart(program, row.bytes, selected.whole, ledger, signal, from);
        if (start < 0) return undefined;
        ledger.charge("allocationUnits", 2, signal);
        return { start, end: start + program.bytes.length };
      });
      results.push(await enumerate(input, row, finders, usage, signal));
      continue;
    }
    let start = -1;
    let end = -1;
    for (const program of programs) {
      const candidate = await literalStart(program, row.bytes, selected.whole, ledger, signal);
      if (candidate < 0) continue;
      if (start < 0 || candidate < start) { start = candidate; end = start + program.bytes.length; }
      if (selected.kind === "grep") break;
    }
    signal.throwIfAborted();
    if (start >= 0) {
      if (usage.count >= input.limits.maxTotalMatches || usage.count >= Math.floor(input.limits.maxResultBytes / 16)) fail("limit", "total match or result byte limit exceeded");
      usage.count++;
    }
    results.push(start < 0 ? new Float64Array() : new Float64Array([start, end]));
  }
  return { id: input.id, results };
}

async function execute(input: OwnedRequest, signal: AbortSignal): Promise<Reply> {
  const { descriptor: selected, rows, ledger } = input;
  if (selected.fixed) return executeLiteral(input, signal);
  const programs: EreProgram[] = [];
  for (const pattern of selected.patterns) {
    if (selected.kind === "rg" && !selected.nullData && pattern.includes("\n")) fail("unsupported", "rg multiline matching is unsupported");
    ledger.charge("allocationUnits", (selected.whole ? 3 : 1) * 3 + 2, signal);
    const fragments: EreFragment[] = selected.kind === "grep" && !selected.extended
      ? await breFragments(pattern, ledger, signal)
      : [{ text: pattern, literal: false }];
    if (selected.whole) {
      ledger.charge("work", fragments.length, signal);
      await ledger.checkpoint(signal);
      fragments.unshift({ text: "^(", literal: false });
      fragments.push({ text: ")$", literal: false });
    }
    programs.push(await compileEre(fragments, ledger, signal, selected.kind === "grep" && selected.insensitive));
  }
  ledger.charge("allocationUnits", 3, signal);
  const results: Float64Array[] = [];
  const usage: MatchUsage = { count: 0 };
  for (const row of rows) {
    const subject = await prepareUtf8EreSubject(row.bytes, ledger, signal);
    if (row.all) {
      ledger.charge("allocationUnits", programs.length + 1, signal);
      const finders: ((from: number) => Promise<Span | undefined>)[] = [];
      for (const program of programs) finders.push(subject(program));
      results.push(await enumerate(input, row, finders, usage, signal));
      continue;
    }
    let span: { readonly start: number; readonly end: number } | undefined;
    for (const program of programs) {
      const candidate = await subject(program)(0);
      if (!candidate) continue;
      if (selected.kind === "grep") { span = candidate; break; }
      // Fixed rg patterns select the first occurrence, breaking ties by pattern order.
      if (!span || candidate.start < span.start) span = candidate;
    }
    signal.throwIfAborted();
    if (span) {
      if (usage.count >= input.limits.maxTotalMatches || usage.count >= Math.floor(input.limits.maxResultBytes / 16)) fail("limit", "total match or result byte limit exceeded");
      usage.count++;
    }
    results.push(span ? new Float64Array([span.start, span.end]) : new Float64Array());
  }
  return { id: input.id, results };
}

class CooperativeWorker implements RegexWorker {
  readonly #controller = new AbortController();
  readonly #listeners = new Map<WorkerEvent, Set<Listener>>();
  readonly #tasks = new Set<Promise<void>>();
  #busy = false;
  #closing: Promise<void> | undefined;

  constructor(private readonly limits: Required<BoundedRegexProviderOptions>, private readonly release: () => void) {
    queueMicrotask(() => { if (!this.#closing) this.emit({ ready: true }); });
  }

  on(event: WorkerEvent, listener: Listener): void {
    if (this.#closing) return;
    let listeners = this.#listeners.get(event);
    if (!listeners) { listeners = new Set(); this.#listeners.set(event, listeners); }
    listeners.add(listener);
  }

  off(event: WorkerEvent, listener: Listener): void { this.#listeners.get(event)?.delete(listener); }

  private emit(value: unknown): void {
    for (const listener of this.#listeners.get("message") ?? []) (listener as (message: unknown) => void)(value);
  }

  postMessage(input: RegexWorkerRequest): void {
    if (this.#closing) throw new Error("bounded regex worker is closed");
    if (this.#busy) throw new Error("bounded regex worker is busy");
    const identity = input !== null && typeof input === "object" ? Object.getOwnPropertyDescriptor(input, "id") : undefined;
    if (!identity || !("value" in identity) || !Number.isSafeInteger(identity.value) || identity.value < 1) fail("protocol", "invalid request identity");
    const id = identity.value as number;
    const submitted = Object.getOwnPropertyDescriptor(input, "descriptor")?.value as unknown;
    const operation: unknown = submitted !== null && typeof submitted === "object" ? Object.getOwnPropertyDescriptor(submitted, "kind")?.value : undefined;
    const expression = operation === "expr-match" || operation === "bre-search";
    let owned: OwnedRequest | OwnedExprRequest | undefined;
    let failure: string | undefined;
    let category: ExprMatchError["category"] = "unsupported";
    try { owned = expression ? admitExpr(input, this.limits, this.#controller.signal) : admit(input, this.limits, this.#controller.signal); }
    catch (error) {
      if (!(error instanceof ExprMatchError || error instanceof PublicDiagnostic || error instanceof EreSyntaxError || error instanceof EreUnsupportedError || error instanceof EreProfileLimitError || error instanceof EreUsageUnknownError)) throw error;
      if (error instanceof ExprMatchError) category = error.category;
      failure = error.message.slice(0, 512);
    }
    this.#busy = true;
    const task = Promise.resolve().then(async () => {
      let reply: Reply | ExprMatchReply | BreSearchReply;
      try {
        this.#controller.signal.throwIfAborted();
        reply = owned ? "subject" in owned ? await executeExpr(owned, this.#controller.signal) : await execute(owned, this.#controller.signal) : { id, error: failure! };
      } catch (error) {
        if (!(error instanceof ExprMatchError || error instanceof PublicDiagnostic || error instanceof EreSyntaxError || error instanceof EreUnsupportedError || error instanceof EreProfileLimitError || error instanceof EreUsageUnknownError)) {
          owned = undefined;
          this.#busy = false;
          for (const listener of this.#listeners.get("error") ?? []) (listener as (reason: unknown) => void)(error);
          return;
        }
        if (error instanceof ExprMatchError) category = error.category;
        reply = { id, error: error.message.slice(0, 512) };
      }
      if (expression && "error" in reply) reply = { id, operation: operation === "bre-search" ? "bre-search" : "expr-match", category, error: reply.error };
      // Clear request-owned payloads before notifying the consumer or allowing reuse.
      owned = undefined;
      this.#busy = false;
      if (!this.#closing) this.emit(reply);
    });
    this.#tasks.add(task);
    void task.then(() => this.#tasks.delete(task), () => this.#tasks.delete(task));
  }

  terminate(): Promise<void> {
    if (!this.#closing) {
      this.#closing = Promise.allSettled([...this.#tasks]).then(() => {
        this.#listeners.clear();
        this.#tasks.clear();
        this.release();
      });
      this.#controller.abort(new Error("bounded regex worker terminated"));
    }
    return this.#closing;
  }
}

/** Cooperative ASCII grep patterns over UTF-8 scalars, ASCII expr, and UTF-8 literals; not a native-worker/RSS sandbox. */
export function createBoundedRegexProvider(input: BoundedRegexProviderOptions = {}): BoundedRegexProvider {
  const limits = options(input);
  let active = 0;
  return Object.freeze({
    createWorker(): RegexWorker {
      if (active >= limits.maxWorkers) fail("limit", "worker count limit exceeded");
      active++;
      return new CooperativeWorker(limits, () => { active--; });
    },
  });
}
