import { PublicDiagnostic } from "../../public-diagnostic.js";
import { foldAscii, isAsciiWord } from "./ascii.js";
import { runYieldCheckpoint, yieldTurn } from "../../contracts/yield.js";
import { matchExprSteps, searchBreSteps } from "../expr/bre-engine.js";
import { EreSyntaxError, EreUnsupportedError, EreProfileLimitError, EreUsageUnknownError } from "./ere/errors.js";
import { EreLedger } from "./ere/limits.js";
import { compileEre } from "./ere/syntax.js";
import { prepareUtf8EreSubject, tryMatchEreAsciiRangeSync, warmEreProgram } from "./ere/matcher.js";
import { validateUtf8 } from "./utf8.js";
import { executeBoundedGlobs } from "./bounded-glob.js";
import type { EreFragment, EreProgram } from "./ere/types.js";
import type { BoundedRegexProvider, RegexWorker, RegexWorkerRequest } from "./provider.js";
import { ExprMatchError, exprMatchCeilings, inProcessRegexProviders,
  inProcessRegexWorkers, reusableBatchRows, trustedInputRows, trustedWorkerReplies, trustedWorkerRequests, type BreSearchDescriptor, type BreSearchReply, type ExprMatchDescriptor, type ExprMatchLimits, type ExprMatchReply, type GlobDescriptor, type GrepDescriptor, type Match, type Reply, type Row, type SearchDescriptor } from "./protocol.js";

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
  maxWorkers: Infinity, maxPatterns: Infinity, maxPatternBytes: Infinity, maxRows: Infinity,
  maxInputBytes: Infinity, maxResultBytes: Infinity, maxWork: Infinity,
  maxAllocationUnits: Infinity, maxStates: Infinity, maxMatchesPerLine: Infinity, maxTotalMatches: Infinity,
});

type SelectionDescriptor = GrepDescriptor | SearchDescriptor;
interface OwnedRequest {
  readonly id: number;
  readonly descriptor: SelectionDescriptor;
  readonly rows: readonly Row[];
  readonly ledger: EreLedger;
  readonly limits: Required<BoundedRegexProviderOptions>;
}
interface OwnedGlobRequest extends Omit<OwnedRequest, "descriptor"> { readonly descriptor: GlobDescriptor }
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

const emptyFloat64 = new Float64Array(0);
const emptyFloat64Results: readonly Float64Array[] = [];
const emptyMatchRow: Match[] = [];
const reusableDirectMatchesPool: Match[] = new Array(128).fill(emptyMatchRow);
const reusableDirectMatchesByLength: Match[][][] = Array.from({ length: 129 }, (_, k) => reusableDirectMatchesPool.slice(0, k) as unknown as Match[][]);
const reusableTrustedReply: { id: number; results: readonly Float64Array[]; directMatches: Match[][] } = {
  id: 0,
  results: emptyFloat64Results,
  directMatches: [],
};
trustedWorkerReplies.add(reusableTrustedReply);

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
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new RangeError(`bounded regex option ${key} is outside its limit`);
    result[key] = value;
  }
  return Object.freeze(result);
}

function descriptor(value: unknown, limits: Required<BoundedRegexProviderOptions>, trusted = false): SelectionDescriptor | GlobDescriptor {
  if (trusted && value !== null && typeof value === "object") {
    const d = value as SelectionDescriptor | GlobDescriptor;
    if (d.kind === "rg" || d.kind === "grep") {
      if (d.patterns.length > limits.maxPatterns) fail("limit", "pattern count limit exceeded");
      const maxPatternBytes = limits.maxPatternBytes;
      if (maxPatternBytes !== Infinity) {
        let bytes = 0;
        for (let index = 0; index < d.patterns.length; index++) {
          const pattern = d.patterns[index]!;
          if (pattern.length > maxPatternBytes - bytes) fail("limit", "aggregate pattern byte limit exceeded");
          bytes += pattern.length;
        }
      }
      return d;
    }
  }
  if (value === null || typeof value !== "object") fail("protocol", "invalid descriptor");
  const kind = Object.getOwnPropertyDescriptor(value, "kind");
  if (!kind || !("value" in kind)) fail("protocol", "invalid descriptor kind");
  if (kind.value === "glob") {
    record(value, ["kind", "patterns", "globOptions"]);
    array(value.patterns, limits.maxPatterns, "pattern");
    array(value.globOptions, limits.maxPatterns, "glob option");
    if (value.patterns.length !== value.globOptions.length) fail("protocol", "invalid glob option count");
    let bytes = 0;
    for (let index = 0; index < value.patterns.length; index++) {
      const pattern = value.patterns[index];
      if (typeof pattern !== "string") fail("protocol", "glob patterns must be strings");
      if (pattern.length > Math.floor((limits.maxPatternBytes - bytes) / 2)) fail("limit", "aggregate pattern byte limit exceeded");
      bytes += pattern.length * 2;
      const option = value.globOptions[index];
      record(option, ["insensitive", "literalUnclosedClass"]);
      if (typeof option.insensitive !== "boolean" || typeof option.literalUnclosedClass !== "boolean") fail("protocol", "invalid glob options");
    }
    return value as unknown as GlobDescriptor;
  }
  if (kind.value !== "grep" && kind.value !== "rg") fail("unsupported", "unsupported descriptor kind");
  const flags = kind.value === "grep" ? ["fixed", "extended", "insensitive", "whole", "word"] : ["fixed", "whole", "word", "nullData"];
  record(value, ["kind", "patterns", ...flags, ...(kind.value === "rg" ? ["case"] : [])]);
  for (const flag of flags) if (typeof value[flag] !== "boolean") fail("protocol", `invalid ${flag} flag`);
  if (kind.value === "rg" && !["sensitive", "insensitive", "smart"].includes(value.case as string)) fail("protocol", "invalid case flag");
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

function admit(input: RegexWorkerRequest, limits: Required<BoundedRegexProviderOptions>, signal: AbortSignal, allowSharedLedger = true): OwnedRequest | OwnedGlobRequest {
  const trusted = trustedWorkerRequests.has(input);
  if (!trusted) record(input, ["id", "descriptor", "rows"]);
  const selected = descriptor(input.descriptor, limits, trusted);
  if (trusted && Array.isArray(input.rows)) {
    if (input.rows.length > limits.maxRows) fail("limit", "row count limit exceeded");
  } else {
    array(input.rows, limits.maxRows, "row");
  }
  if (selected.kind === "glob" && input.rows.length !== 0 && input.rows.length !== selected.patterns.length) fail("protocol", "invalid glob row count");
  if (limits.maxResultBytes !== Infinity && input.rows.length > Math.floor(limits.maxResultBytes / 16)) fail("limit", "result byte limit exceeded");
  let bytes = 0;
  const maxInputBytes = limits.maxInputBytes;
  const knownTrustedRows = trusted && selected.kind !== "glob" && trustedInputRows.has(input.rows);
  let allTrustedRows = trusted && selected.kind !== "glob";
  if (knownTrustedRows) {
    for (let index = 0; index < input.rows.length; index++) {
      const r = input.rows[index]! as Row & { start?: number; searchEnd?: number };
      const length = typeof r.searchEnd === "number" ? r.searchEnd - r.start! : r.bytes.byteLength;
      if (maxInputBytes !== Infinity && length > maxInputBytes - bytes) fail("limit", "aggregate input byte limit exceeded");
      bytes += length;
    }
  } else for (let index = 0; index < input.rows.length; index++) {
    const row = input.rows[index]!;
    if (allTrustedRows && row && row.bytes instanceof Uint8Array && typeof row.all === "boolean" && typeof row.terminated === "boolean" && !Object.hasOwn(row, "directory") && !Object.hasOwn(row, "ancestors")) {
      const length = row.bytes.byteLength;
      if (maxInputBytes !== Infinity && length > maxInputBytes - bytes) fail("limit", "aggregate input byte limit exceeded");
      bytes += length;
      continue;
    }
    allTrustedRows = false;
    record(row, ["bytes", "all", "terminated"], ["directory", "ancestors"]);
    if (!(row.bytes instanceof Uint8Array) || typeof row.all !== "boolean" || typeof row.terminated !== "boolean"
      || Object.hasOwn(row, "directory") && typeof row.directory !== "boolean"
      || Object.hasOwn(row, "ancestors") && typeof row.ancestors !== "boolean") fail("protocol", "invalid row");
    if (selected.kind !== "glob" && (Object.hasOwn(row, "directory") || Object.hasOwn(row, "ancestors"))) fail("protocol", "unexpected glob row flags");
    const length = byteLength.call(row.bytes) as number;
    if (selected.kind === "glob" && (row.all || length % 2 !== 0)) fail("protocol", "invalid glob row");
    if (maxInputBytes !== Infinity && length > maxInputBytes - bytes) fail("limit", "aggregate input byte limit exceeded");
    bytes += length;
  }
  if (allowSharedLedger && knownTrustedRows) {
    const ledger = sharedSyncLedger.resetWithLimits(getPrevalidatedEreLimits(limits, selected.fixed));
    ledger.charge("allocationUnits", bytes + input.rows.length * 12 + selected.patterns.length * 2 + 16, signal);
    sharedOwnedRequest.id = input.id;
    sharedOwnedRequest.descriptor = selected as SelectionDescriptor;
    sharedOwnedRequest.rows = input.rows;
    sharedOwnedRequest.ledger = ledger;
    sharedOwnedRequest.limits = limits;
    return sharedOwnedRequest;
  }
  const ledger = selected.kind !== "glob"
    ? EreLedger.withPrevalidatedLimits(getPrevalidatedEreLimits(limits, selected.fixed))
    : new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity }, {
      patternBytes: Infinity, subjectBytes: limits.maxInputBytes,
      work: limits.maxWork, allocationUnits: limits.maxAllocationUnits, states: limits.maxStates,
    });
  // Include snapshots, row/result metadata and worst-case match storage before copying.
  ledger.charge("allocationUnits", bytes + input.rows.length * 12 + selected.patterns.length * 2 + 16, signal);
  const patterns: string[] = [];
  for (let index = 0; index < selected.patterns.length; index++) patterns.push(selected.patterns[index]!);
  const globOptions: GlobDescriptor["globOptions"][number][] = [];
  if (selected.kind === "glob") {
    ledger.charge("allocationUnits", selected.globOptions.length * 4, signal);
    for (let index = 0; index < selected.globOptions.length; index++) {
      const option = selected.globOptions[index]!;
      globOptions.push({ insensitive: option.insensitive, literalUnclosedClass: option.literalUnclosedClass });
    }
  }
  const ownedDescriptor = selected.kind === "glob"
    ? { kind: "glob" as const, patterns, globOptions }
    : selected.kind === "grep"
    ? { kind: "grep", patterns, fixed: selected.fixed, extended: selected.extended, insensitive: selected.insensitive, whole: selected.whole, word: selected.word }
    : { kind: "rg", patterns, fixed: selected.fixed, case: selected.case, whole: selected.whole, word: selected.word, nullData: selected.nullData };
  if (allTrustedRows) {
    return { id: input.id, descriptor: ownedDescriptor, rows: input.rows, ledger, limits } as OwnedRequest;
  }
  const rows: Row[] = [];
  for (let index = 0; index < input.rows.length; index++) {
    const row = input.rows[index]!;
    const source = new Uint8Array(byteBuffer.call(row.bytes) as ArrayBuffer, byteOffset.call(row.bytes) as number, byteLength.call(row.bytes) as number);
    const copy = new Uint8Array(source.length);
    copy.set(source);
    rows.push({ bytes: copy, all: row.all, terminated: row.terminated, ...(selected.kind === "glob" ? { directory: row.directory ?? false, ancestors: row.ancestors ?? true } : {}) });
  }
  return { id: input.id, descriptor: ownedDescriptor, rows, ledger, limits } as OwnedRequest | OwnedGlobRequest;
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
    if (typeof value !== "number" || value !== Infinity && (!Number.isSafeInteger(value) || value < 1)) fail("protocol", "invalid expr limits");
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


function literalBytes(pattern: string, selected: SelectionDescriptor, ledger: EreLedger, signal: AbortSignal): Uint8Array | Promise<Uint8Array> {
  const { kind } = selected;
  if (ledger.workAllowanceUntilCheckpoint(signal) >= pattern.length * 6 + 8) {
    let length = 0;
    if (kind === "grep") {
      const pendingUtf8 = validateUtf8(pattern, ledger, signal);
      if (pendingUtf8) return literalBytesAsync(pattern, selected, ledger, signal, pendingUtf8);
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
    }
    return bytes;
  }
  return literalBytesAsync(pattern, selected, ledger, signal);
}

async function literalBytesAsync(pattern: string, selected: SelectionDescriptor, ledger: EreLedger, signal: AbortSignal, pendingUtf8?: Promise<void>): Promise<Uint8Array> {
  const { kind } = selected;
  let length = 0;
  if (kind === "grep") {
    if (pendingUtf8) await pendingUtf8;
    else await validateUtf8(pattern, ledger, signal);
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

interface LiteralProgram { readonly bytes: Uint8Array; readonly fallback: Uint32Array; readonly insensitive: boolean; readonly singleMatchByStart?: (Match[] | undefined)[] }

function compileLiteral(bytes: Uint8Array, ledger: EreLedger, signal: AbortSignal, insensitive = false): LiteralProgram | Promise<LiteralProgram> {
  if (ledger.workAllowanceUntilCheckpoint(signal) >= bytes.length * 3 + 4) {
    if (insensitive) {
      ledger.charge("work", bytes.length, signal);
      for (let index = 0; index < bytes.length; index++) bytes[index] = foldAscii(bytes[index]!);
    }
    ledger.charge("states", bytes.length, signal);
    ledger.charge("allocationUnits", bytes.length * 4 + 4, signal);
    const fallback = new Uint32Array(bytes.length);
    for (let index = 1, prefix = 0; index < bytes.length;) {
      ledger.charge("work", 1, signal);
      if (bytes[index] === bytes[prefix]) fallback[index++] = ++prefix;
      else if (prefix > 0) prefix = fallback[prefix - 1]!;
      else index++;
    }
    return { bytes, fallback, insensitive, singleMatchByStart: new Array(128) };
  }
  return compileLiteralAsync(bytes, ledger, signal, insensitive);
}

async function compileLiteralAsync(bytes: Uint8Array, ledger: EreLedger, signal: AbortSignal, insensitive = false): Promise<LiteralProgram> {
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

function literalStart(program: LiteralProgram, subject: Uint8Array, whole: boolean, word: boolean, ledger: EreLedger, signal: AbortSignal, from = 0): number | Promise<number> {
  const { bytes, fallback } = program;
  const patLen = bytes.length;
  const subLen = subject.length;
  if (!program.insensitive && patLen > 0 && ledger.workAllowanceUntilCheckpoint(signal) >= (subLen - from) * 2 + 2) {
    ledger.chargeWork(1, signal);
    if (whole && (from !== 0 || patLen !== subLen) || patLen > subLen - from) return -1;
    const firstByte = bytes[0]!;
    for (let index = from, prefix = 0; index < subLen;) {
      if (prefix === 0) {
        let scan = index;
        while (scan < subLen && subject[scan] !== firstByte) scan++;
        if (scan > index) {
          ledger.chargeWork(scan - index, signal);
          index = scan;
          if (index >= subLen) break;
        }
      }
      ledger.chargeWork(1, signal);
      if (subject[index] === bytes[prefix]) {
        index++;
        if (++prefix === patLen) {
          const start = index - prefix;
          if (!word || !isAsciiWord(subject[start - 1] ?? -1) && !isAsciiWord(subject[index] ?? -1)) return start;
          prefix = fallback[prefix - 1]!;
        }
      } else if (prefix > 0) {
        prefix = fallback[prefix - 1]!;
      } else {
        index++;
      }
    }
    return -1;
  }
  return literalStartAsync(program, subject, whole, word, ledger, signal, from);
}

async function literalStartAsync(program: LiteralProgram, subject: Uint8Array, whole: boolean, word: boolean, ledger: EreLedger, signal: AbortSignal, from = 0): Promise<number> {
  const { bytes, fallback } = program;
  ledger.charge("work", 1, signal);
  await ledger.checkpoint(signal);
  if (whole && (from !== 0 || bytes.length !== subject.length) || bytes.length > subject.length - from) return -1;
  if (bytes.length === 0) {
    for (let start = from; start <= subject.length; start++) {
      ledger.charge("work", 1, signal);
      await ledger.checkpoint(signal);
      if (!word || !isAsciiWord(subject[start - 1] ?? -1) && !isAsciiWord(subject[start] ?? -1)) return start;
    }
    return -1;
  }
  for (let index = from, prefix = 0; index < subject.length;) {
    if (prefix === 0 && !program.insensitive) {
      const allowance = ledger.workAllowanceUntilCheckpoint(signal);
      if (allowance > 1) {
        const firstByte = bytes[0]!;
        const maxRun = Math.min(subject.length, index + allowance);
        let scan = index;
        while (scan < maxRun && subject[scan] !== firstByte) {
          scan++;
        }
        if (scan > index) {
          ledger.chargeWork(scan - index, signal);
          index = scan;
          const pending = ledger.checkpoint(signal);
          if (pending) await pending;
          if (index >= subject.length) break;
        }
      }
    }
    ledger.chargeWork(1, signal);
    if ((program.insensitive ? foldAscii(subject[index]!) : subject[index]) === bytes[prefix]) {
      index++;
      if (++prefix === bytes.length) {
        const start = index - prefix;
        if (!word || !isAsciiWord(subject[start - 1] ?? -1) && !isAsciiWord(subject[index] ?? -1)) return start;
        prefix = fallback[prefix - 1]!;
      }
    } else if (prefix > 0) prefix = fallback[prefix - 1]!;
    else index++;
    const pending = ledger.checkpoint(signal);
    if (pending) await pending;
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
  const byteEmpty = input.descriptor.kind === "rg" && !input.descriptor.whole
    && input.descriptor.patterns.length === 1 && input.descriptor.patterns[0] === "";
  const byteCursor = input.descriptor.kind === "grep" && input.descriptor.word;
  let previousEnd = -1;
  for (let from = 0; from <= row.bytes.length;) {
    let best: Span | undefined;
    for (let index = 0; index < finders.length; index++) {
      ledger.charge("work", 1, signal);
      const pending = ledger.checkpoint(signal);
      if (pending) await pending;
      let candidate = cached[index];
      if (candidate === undefined || candidate !== null && candidate.start < from) {
        candidate = await finders[index]!(from) ?? null;
        cached[index] = candidate;
      }
      if (candidate && (!best || candidate.start < best.start || input.descriptor.kind === "grep" && candidate.start === best.start && candidate.end > best.end)) best = candidate;
    }
    if (!best || byteEmpty && !row.terminated && best.start === row.bytes.length) break;
    if (input.descriptor.kind === "rg" && !byteEmpty && best.start === best.end && best.start === previousEnd) {
      const byte = row.bytes[best.end];
      from = best.end + (byte === undefined || byte < 0x80 ? 1 : byte < 0xe0 ? 2 : byte < 0xf0 ? 3 : 4);
      continue;
    }
    if (ranges.length / 2 >= limits.maxMatchesPerLine) fail("limit", "matches per line limit exceeded");
    if (usage.count >= limits.maxTotalMatches) fail("limit", "total match limit exceeded");
    if (usage.count >= Math.floor(limits.maxResultBytes / 16)) fail("limit", "result byte limit exceeded");
    ledger.charge("work", 2, signal);
    // Charge temporary number pairs and the final Float64Array before retaining either.
    ledger.charge("allocationUnits", 24, signal);
    usage.count++;
    ranges.push(best.start, best.end);
    previousEnd = best.end;
    if (best.end > best.start) from = best.end;
    else {
      const byte = row.bytes[best.end];
      from = best.end + (byteEmpty || byteCursor || byte === undefined || byte < 0x80 ? 1 : byte < 0xe0 ? 2 : byte < 0xf0 ? 3 : 4);
    }
  }
  ledger.charge("work", ranges.length, signal);
  await ledger.checkpoint(signal);
  return new Float64Array(ranges);
}

interface CachedLiteralPrograms {
  readonly kind: SelectionDescriptor["kind"];
  readonly fold: boolean;
  readonly nullData: boolean;
  readonly pattern0: string;
  readonly programs: readonly LiteralProgram[];
  readonly work: number;
  readonly patternBytes: number;
  readonly states: number;
  readonly allocationUnits: number;
}
let lastLiteralCache: CachedLiteralPrograms | undefined;
interface EreCacheEntry {
  readonly key: string;
  readonly programs: readonly EreProgram[];
  readonly work: number;
  readonly patternBytes: number;
  readonly states: number;
  readonly allocationUnits: number;
  singleMatchByEnd?: [Match][];
}
let lastEreCache: EreCacheEntry | undefined;

function ereCacheKeyFor(selected: SelectionDescriptor, fold: boolean): string | undefined {
  if (selected.patterns.length !== 1 || selected.patterns[0]!.length > 128) return undefined;
  return `${selected.kind}:${fold ? 1 : 0}:${selected.kind === "rg" && selected.nullData ? 1 : 0}:${selected.kind === "grep" && !selected.extended ? 1 : 0}:${selected.whole ? 1 : 0}:${selected.patterns[0]}`;
}

function tryExecuteEreSync(input: OwnedRequest, signal: AbortSignal, fold: boolean): Reply | undefined {
  const { descriptor: selected, rows, ledger } = input;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.all) return undefined;
  }
  const cacheKey = ereCacheKeyFor(selected, fold);
  if (cacheKey === undefined || lastEreCache?.key !== cacheKey) return undefined;
  const programs = lastEreCache.programs;
  for (let p = 0; p < programs.length; p++) {
    if (programs[p]!.groups !== 0) return undefined;
  }
  let estimatedWork = lastEreCache.work + 256;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]! as Row & { start?: number; searchEnd?: number };
    const rLen = typeof r.searchEnd === "number" ? r.searchEnd - r.start! : r.bytes.length;
    estimatedWork += rLen * 6 + 8;
  }
  if (ledger.workAllowanceUntilCheckpoint(signal) < estimatedWork) {
    if (estimatedWork > 32768 || !ledger.advanceSyncCheckpointIfNoExternalYield?.(signal) || ledger.workAllowanceUntilCheckpoint(signal) < Math.min(estimatedWork, 16384)) {
      return undefined;
    }
  }
  ledger.charge("work", lastEreCache.work, signal);
  ledger.charge("patternBytes", lastEreCache.patternBytes, signal);
  ledger.charge("states", lastEreCache.states, signal);
  ledger.charge("allocationUnits", lastEreCache.allocationUnits + 3, signal);
  runYieldCheckpoint(signal);
  if (rows.length === 0) {
    signal.throwIfAborted();
    reusableTrustedReply.id = input.id;
    reusableTrustedReply.directMatches = reusableDirectMatchesByLength[0]!;
    return reusableTrustedReply;
  }
  const directMatches: Match[][] = reusableBatchRows.has(rows) && rows.length <= 128
    ? reusableDirectMatchesByLength[rows.length]!
    : new Array(rows.length);
  let matchCount = 0;
  const maxMatches = input.limits.maxTotalMatches === Infinity && input.limits.maxResultBytes === Infinity
    ? 0x3fffffff
    : Math.min(input.limits.maxTotalMatches, Math.floor(input.limits.maxResultBytes / 16));
  const leftmostFirst = selected.kind === "rg";
  const word = selected.word;
  for (let r = 0; r < rows.length; r++) {
    if (ledger.workAllowanceUntilCheckpoint(signal) < 256) {
      ledger.advanceSyncCheckpointIfNoExternalYield?.(signal);
    }
    const row = rows[r]! as Row & { chunk?: Uint8Array; start?: number; searchEnd?: number };
    const hasRange = row.chunk !== undefined && typeof row.start === "number" && typeof row.searchEnd === "number";
    const buf = hasRange ? row.chunk! : row.bytes;
    const rStart = hasRange ? row.start! : 0;
    const rEnd = hasRange ? row.searchEnd! : buf.length;
    for (let i = rStart; i < rEnd; i++) {
      const b = buf[i]!;
      if (b === 0 || b >= 0x80) return undefined;
    }
    let bestSpan: { readonly start: number; readonly end: number } | undefined;
    for (let p = 0; p < programs.length; p++) {
      const candidate = tryMatchEreAsciiRangeSync(programs[p]!, buf, rStart, rEnd, ledger, signal, leftmostFirst, word);
      if (candidate === null) return undefined;
      if (!candidate) continue;
      if (selected.kind === "grep") { bestSpan = candidate; break; }
      if (!bestSpan || candidate.start < bestSpan.start) bestSpan = candidate;
    }
    if (bestSpan) {
      if (matchCount >= maxMatches) fail("limit", "total match or result byte limit exceeded");
      matchCount++;
      if (bestSpan.start === 0 && bestSpan.end < 128) {
        const byEnd = lastEreCache.singleMatchByEnd ??= [];
        directMatches[r] = byEnd[bestSpan.end] ??= [bestSpan];
      } else {
        directMatches[r] = [{ start: bestSpan.start, end: bestSpan.end }];
      }
    } else {
      directMatches[r] = emptyMatchRow;
    }
  }
  signal.throwIfAborted();
  reusableTrustedReply.id = input.id;
  reusableTrustedReply.directMatches = directMatches;
  return reusableTrustedReply;
}
const sharedSyncLedger = EreLedger.withPrevalidatedLimits(Object.freeze({
  patternBytes: Infinity, subjectBytes: Infinity, work: Infinity,
  states: Infinity, allocationUnits: Infinity, captureBytes: Infinity, captureSlots: Infinity,
}));
const sharedOwnedRequest: {
  id: number;
  descriptor: SelectionDescriptor;
  rows: readonly Row[];
  ledger: EreLedger;
  limits: Required<BoundedRegexProviderOptions>;
} = {
  id: 0,
  descriptor: undefined as unknown as SelectionDescriptor,
  rows: [],
  ledger: sharedSyncLedger,
  limits: undefined as unknown as Required<BoundedRegexProviderOptions>,
};
let cachedWorkerLimitsRef: Required<BoundedRegexProviderOptions> | undefined;
let cachedFixedEreLimits: any;
let cachedRegexEreLimits: any;
function getPrevalidatedEreLimits(limits: Required<BoundedRegexProviderOptions>, fixed: boolean): any {
  if (cachedWorkerLimitsRef !== limits) {
    cachedWorkerLimitsRef = limits;
    cachedFixedEreLimits = Object.freeze({
      patternBytes: limits.maxPatternBytes, subjectBytes: limits.maxInputBytes,
      work: limits.maxWork, allocationUnits: limits.maxAllocationUnits, states: limits.maxStates,
      captureBytes: Infinity, captureSlots: Infinity,
    });
    cachedRegexEreLimits = Object.freeze({
      patternBytes: limits.maxPatternBytes + 4, subjectBytes: limits.maxInputBytes,
      work: limits.maxWork, allocationUnits: limits.maxAllocationUnits, states: limits.maxStates,
      captureBytes: Infinity, captureSlots: Infinity,
    });
  }
  return fixed ? cachedFixedEreLimits : cachedRegexEreLimits;
}

let lastRangeSyncWork = 0;

function literalStartRangeSync(program: LiteralProgram, buf: Uint8Array, rStart: number, rEnd: number, whole: boolean, word: boolean): number | undefined {
  const { bytes, fallback } = program;
  const patLen = bytes.length;
  const subLen = rEnd - rStart;
  if (program.insensitive || patLen === 0) return undefined;
  let work = 1;
  if (whole && patLen !== subLen || patLen > subLen) {
    lastRangeSyncWork = work;
    return -1;
  }
  const firstByte = bytes[0]!;
  for (let index = rStart, prefix = 0; index < rEnd;) {
    if (prefix === 0) {
      let scan = index;
      while (scan < rEnd && buf[scan] !== firstByte) scan++;
      if (scan > index) {
        work += scan - index;
        index = scan;
        if (index >= rEnd) break;
      }
    }
    work += 1;
    if (buf[index] === bytes[prefix]) {
      index++;
      if (++prefix === patLen) {
        const matchAbs = index - prefix;
        if (!word || !isAsciiWord(matchAbs > rStart ? buf[matchAbs - 1]! : -1) && !isAsciiWord(index < rEnd ? buf[index]! : -1)) {
          lastRangeSyncWork = work;
          return matchAbs - rStart;
        }
        prefix = fallback[prefix - 1]!;
      }
    } else if (prefix > 0) {
      prefix = fallback[prefix - 1]!;
    } else {
      index++;
    }
  }
  lastRangeSyncWork = work;
  return -1;
}

function tryExecuteLiteralSync(input: OwnedRequest, signal: AbortSignal, fold: boolean): Reply | undefined {
  const { descriptor: selected, rows, ledger } = input;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.all) return undefined;
  }
  if (selected.patterns.length !== 1) return undefined;
  const pattern0 = selected.patterns[0]!;
  if (pattern0.length > 128) return undefined;
  const nullData = selected.kind === "rg" && selected.nullData;
  if (
    lastLiteralCache?.kind !== selected.kind ||
    lastLiteralCache.fold !== fold ||
    lastLiteralCache.nullData !== nullData ||
    lastLiteralCache.pattern0 !== pattern0
  ) {
    const snapBefore = ledger.usage;
    const compiled: LiteralProgram[] = [];
    for (const pattern of selected.patterns) {
      const bytesOrPromise = literalBytes(pattern, selected, ledger, signal);
      if (!(bytesOrPromise instanceof Uint8Array)) return undefined;
      if (fold && selected.kind === "rg" && bytesOrPromise.some(byte => byte >= 128)) fail("unsupported", "rg case folding supports ASCII patterns only");
      const progOrPromise = compileLiteral(bytesOrPromise, ledger, signal, fold);
      if (!("bytes" in progOrPromise)) return undefined;
      compiled.push(progOrPromise);
    }
    const snapAfter = ledger.usage;
    lastLiteralCache = {
      kind: selected.kind,
      fold,
      nullData,
      pattern0,
      programs: compiled,
      work: (snapAfter.work - snapBefore.work) | 0,
      patternBytes: (snapAfter.patternBytes - snapBefore.patternBytes) | 0,
      states: (snapAfter.states - snapBefore.states) | 0,
      allocationUnits: (snapAfter.allocationUnits - snapBefore.allocationUnits) | 0,
    };
  } else {
    if (ledger.workAllowanceUntilCheckpoint(signal) < lastLiteralCache.work) return undefined;
    ledger.charge("work", lastLiteralCache.work, signal);
    ledger.charge("patternBytes", lastLiteralCache.patternBytes, signal);
    ledger.charge("states", lastLiteralCache.states, signal);
    ledger.charge("allocationUnits", lastLiteralCache.allocationUnits, signal);
  }
  // Check if total row work fits within workAllowanceUntilCheckpoint
  const workPerByte = selected.kind === "grep" ? 2 : 3;
  let estimatedWork = 3;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]! as Row & { start?: number; searchEnd?: number };
    const rLen = typeof r.searchEnd === "number" ? r.searchEnd - r.start! : r.bytes.length;
    estimatedWork = (estimatedWork + Math.imul(rLen, workPerByte) + 2) | 0;
  }
  if (ledger.workAllowanceUntilCheckpoint(signal) < estimatedWork) {
    return undefined;
  }
  runYieldCheckpoint(signal);
  const programs = lastLiteralCache.programs;
  ledger.charge("allocationUnits", 3, signal);
  const directMatches: Match[][] = reusableBatchRows.has(rows) && rows.length <= 128
    ? reusableDirectMatchesByLength[rows.length]!
    : new Array(rows.length);
  let matchCount = 0;
  let batchWork = 0;
  const maxMatches = input.limits.maxTotalMatches === Infinity && input.limits.maxResultBytes === Infinity
    ? 0x3fffffff
    : Math.min(input.limits.maxTotalMatches, Math.floor(input.limits.maxResultBytes / 16));
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]! as Row & { chunk?: Uint8Array; start?: number; searchEnd?: number };
    const hasRange = row.chunk !== undefined && typeof row.start === "number" && typeof row.searchEnd === "number";
    const buf = hasRange ? row.chunk! : row.bytes;
    const rStart = hasRange ? row.start! : 0;
    const rEnd = hasRange ? row.searchEnd! : buf.length;
    const rLen = rEnd - rStart;
    if (selected.kind === "rg") {
      let ascii = true;
      for (let i = rStart; i < rEnd; i++) {
        const b = buf[i]!;
        if (b === 0 || b >= 0x80) { ascii = false; break; }
      }
      if (!ascii) {
        if (batchWork > 0) { ledger.chargeWork(batchWork, signal); batchWork = 0; }
        const pendingUtf8 = validateUtf8(row.bytes, ledger, signal);
        if (pendingUtf8) return undefined;
        if ((selected.word || fold) && row.bytes.some(byte => byte >= 128)) fail("unsupported", "rg word matching and case folding support ASCII subjects only");
      } else {
        batchWork += rLen;
      }
    } else {
      batchWork += rLen;
    }
    let start = -1;
    let end = -1;
    let matchedProg: LiteralProgram | undefined;
    for (let p = 0; p < programs.length; p++) {
      const program = programs[p]!;
      let candidate: number | Promise<number> | undefined;
      if (hasRange && !program.insensitive && program.bytes.length > 0) {
        candidate = literalStartRangeSync(program, buf, rStart, rEnd, selected.whole, selected.word);
        if (candidate !== undefined) batchWork += lastRangeSyncWork;
      } else {
        if (batchWork > 0) { ledger.chargeWork(batchWork, signal); batchWork = 0; }
        candidate = literalStart(program, row.bytes, selected.whole, selected.word, ledger, signal);
      }
      if (typeof candidate !== "number") return undefined;
      if (candidate < 0) continue;
      if (start < 0 || candidate < start) { start = candidate; end = start + program.bytes.length; matchedProg = program; }
      if (selected.kind === "grep") break;
    }
    if (start >= 0) {
      if (matchCount >= maxMatches) {
        if (batchWork > 0) { ledger.chargeWork(batchWork, signal); batchWork = 0; }
        fail("limit", "total match or result byte limit exceeded");
      }
      matchCount++;
      directMatches[r] = start < 128 && matchedProg?.singleMatchByStart
        ? (matchedProg.singleMatchByStart[start] ??= [{ start, end }])
        : [{ start, end }];
    } else {
      directMatches[r] = emptyMatchRow;
    }
  }
  if (batchWork > 0) ledger.chargeWork(batchWork, signal);
  else signal.throwIfAborted();
  reusableTrustedReply.id = input.id;
  reusableTrustedReply.directMatches = directMatches;
  return reusableTrustedReply;
}

function tryExecuteSync(input: OwnedRequest, signal: AbortSignal): Reply | undefined {
  const { descriptor: selected, ledger } = input;
  const foldOrPromise = insensitive(selected, ledger, signal);
  if (typeof foldOrPromise !== "boolean") return undefined;
  let literal = selected.fixed;
  if (!literal) {
    literal = true;
    patterns: for (let pIdx = 0; pIdx < selected.patterns.length; pIdx++) {
      const pattern = selected.patterns[pIdx]!;
      if (ledger.workAllowanceUntilCheckpoint(signal) < pattern.length) return undefined;
      ledger.charge("work", pattern.length, signal);
      for (let cIdx = 0; cIdx < pattern.length; cIdx++) {
        const ch = pattern.charCodeAt(cIdx);
        if (
          ch === 92 || ch === 46 || ch === 94 || ch === 36 || ch === 91 || ch === 93 ||
          ch === 40 || ch === 41 || ch === 124 || ch === 42 || ch === 43 || ch === 63 ||
          ch === 123 || ch === 125 || (selected.kind === "grep" && ch >= 128)
        ) {
          literal = false;
          break patterns;
        }
      }
    }
  }
  if (!literal) return tryExecuteEreSync(input, signal, foldOrPromise);
  return tryExecuteLiteralSync(input, signal, foldOrPromise);
}

async function executeLiteral(input: OwnedRequest, signal: AbortSignal, fold: boolean): Promise<Reply> {
  const { descriptor: selected, rows, ledger } = input;
  const pattern0 = selected.patterns.length === 1 && selected.patterns[0]!.length <= 128 ? selected.patterns[0]! : undefined;
  const nullData = selected.kind === "rg" && selected.nullData;
  let programs: readonly LiteralProgram[];
  if (
    pattern0 !== undefined &&
    lastLiteralCache?.kind === selected.kind &&
    lastLiteralCache.fold === fold &&
    lastLiteralCache.nullData === nullData &&
    lastLiteralCache.pattern0 === pattern0 &&
    ledger.workAllowanceUntilCheckpoint(signal) >= lastLiteralCache.work
  ) {
    ledger.charge("work", lastLiteralCache.work, signal);
    ledger.charge("patternBytes", lastLiteralCache.patternBytes, signal);
    ledger.charge("states", lastLiteralCache.states, signal);
    ledger.charge("allocationUnits", lastLiteralCache.allocationUnits, signal);
    programs = lastLiteralCache.programs;
  } else {
    const snapBefore = ledger.usage;
    const compiled: LiteralProgram[] = [];
    for (const pattern of selected.patterns) {
      const bytesOrPromise = literalBytes(pattern, selected, ledger, signal);
      const bytes = bytesOrPromise instanceof Uint8Array ? bytesOrPromise : await bytesOrPromise;
      if (fold && selected.kind === "rg" && bytes.some(byte => byte >= 128)) fail("unsupported", "rg case folding supports ASCII patterns only");
      const progOrPromise = compileLiteral(bytes, ledger, signal, fold);
      compiled.push("bytes" in progOrPromise ? progOrPromise : await progOrPromise);
    }
    programs = compiled;
    if (pattern0 !== undefined) {
      const snapAfter = ledger.usage;
      lastLiteralCache = {
        kind: selected.kind,
        fold,
        nullData,
        pattern0,
        programs,
        work: snapAfter.work - snapBefore.work,
        patternBytes: snapAfter.patternBytes - snapBefore.patternBytes,
        states: snapAfter.states - snapBefore.states,
        allocationUnits: snapAfter.allocationUnits - snapBefore.allocationUnits,
      };
    }
  }
  ledger.charge("allocationUnits", 3, signal);
  const results: Float64Array[] = [];
  const usage: MatchUsage = { count: 0 };
  for (const row of rows) {
    if (selected.kind === "rg") {
      const pendingUtf8 = validateUtf8(row.bytes, ledger, signal);
      if (pendingUtf8) await pendingUtf8;
    } else if (ledger.workAllowanceUntilCheckpoint(signal) >= row.bytes.length) {
      ledger.charge("work", row.bytes.length, signal);
    } else {
      // Retain subject admission work and cooperative cancellation for raw bytes.
      for (let index = 0; index < row.bytes.length; index++) {
        ledger.charge("work", 1, signal);
        await ledger.checkpoint(signal);
      }
    }
    if (selected.kind === "rg" && (selected.word || fold) && row.bytes.some(byte => byte >= 128)) fail("unsupported", "rg word matching and case folding support ASCII subjects only");
    if (row.all) {
      ledger.charge("allocationUnits", programs.length * 2, signal);
      const finders = programs.map(program => async (from: number): Promise<Span | undefined> => {
        const start = await literalStart(program, row.bytes, selected.whole, selected.word, ledger, signal, from);
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
      const candidateOrPromise = literalStart(program, row.bytes, selected.whole, selected.word, ledger, signal);
      const candidate = typeof candidateOrPromise === "number" ? candidateOrPromise : await candidateOrPromise;
      if (candidate < 0) continue;
      if (start < 0 || candidate < start) { start = candidate; end = start + program.bytes.length; }
      if (selected.kind === "grep") break;
    }
    signal.throwIfAborted();
    if (start >= 0) {
      if (usage.count >= input.limits.maxTotalMatches || usage.count >= Math.floor(input.limits.maxResultBytes / 16)) fail("limit", "total match or result byte limit exceeded");
      usage.count++;
    }
    results.push(start < 0 ? emptyFloat64 : new Float64Array([start, end]));
  }
  return { id: input.id, results };
}

function insensitive(selected: SelectionDescriptor, ledger: EreLedger, signal: AbortSignal): boolean | Promise<boolean> {
  if (selected.kind === "grep") return selected.insensitive;
  if (selected.case !== "smart") return selected.case === "insensitive";
  for (const pattern of selected.patterns) {
    if (ledger.workAllowanceUntilCheckpoint(signal) < pattern.length) {
      return insensitiveAsync(selected, ledger, signal);
    }
    for (let index = 0; index < pattern.length; index++) {
      ledger.charge("work", 1, signal);
      if (pattern[index]! >= "A" && pattern[index]! <= "Z") return false;
    }
  }
  return true;
}

async function insensitiveAsync(selected: Extract<SelectionDescriptor, { kind: "rg" }>, ledger: EreLedger, signal: AbortSignal): Promise<boolean> {
  for (const pattern of selected.patterns) {
    for (let index = 0; index < pattern.length; index++) {
      ledger.charge("work", 1, signal);
      await ledger.checkpoint(signal);
      if (pattern[index]! >= "A" && pattern[index]! <= "Z") return false;
    }
  }
  return true;
}

async function execute(input: OwnedRequest, signal: AbortSignal): Promise<Reply> {
  const { descriptor: selected, rows, ledger } = input;
  const foldOrPromise = insensitive(selected, ledger, signal);
  const fold = typeof foldOrPromise === "boolean" ? foldOrPromise : await foldOrPromise;
  let literal = selected.fixed;
  if (!literal) {
    literal = true;
    patterns: for (const pattern of selected.patterns) {
      if (ledger.workAllowanceUntilCheckpoint(signal) >= pattern.length) {
        ledger.charge("work", pattern.length, signal);
      } else {
        ledger.charge("work", pattern.length, signal);
        await ledger.checkpoint(signal);
      }
      for (const character of pattern) if ("\\.^$[]()|*+?{}".includes(character)
        || selected.kind === "grep" && character.charCodeAt(0) >= 128) { literal = false; break patterns; }
    }
  }
  if (literal) return executeLiteral(input, signal, fold);
  const ereKey = ereCacheKeyFor(selected, fold);
  const snapBeforeEre = ledger.usage;
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
    programs.push(await compileEre(fragments, ledger, signal, fold));
  }
  const snapAfterEre = ereKey !== undefined ? ledger.usage : undefined;
  ledger.charge("allocationUnits", 3, signal);
  const results: Float64Array[] = [];
  const usage: MatchUsage = { count: 0 };
  for (const row of rows) {
    if (selected.kind === "rg" && (selected.word || fold) && row.bytes.some(byte => byte >= 128)) fail("unsupported", "rg word matching and case folding support ASCII subjects only");
    const subject = await prepareUtf8EreSubject(row.bytes, ledger, signal, selected.kind === "rg", selected.word);
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
      // Rg selects the first occurrence, breaking ties by pattern order.
      if (!span || candidate.start < span.start) span = candidate;
    }
    signal.throwIfAborted();
    if (span) {
      if (usage.count >= input.limits.maxTotalMatches || usage.count >= Math.floor(input.limits.maxResultBytes / 16)) fail("limit", "total match or result byte limit exceeded");
      usage.count++;
    }
    results.push(span ? new Float64Array([span.start, span.end]) : emptyFloat64);
  }
  if (ereKey !== undefined && snapAfterEre !== undefined) {
    for (const prog of programs) {
      if (prog.groups === 0) await warmEreProgram(prog);
    }
    lastEreCache = {
      key: ereKey,
      programs,
      work: snapAfterEre.work - snapBeforeEre.work,
      patternBytes: snapAfterEre.patternBytes - snapBeforeEre.patternBytes,
      states: snapAfterEre.states - snapBeforeEre.states,
      allocationUnits: snapAfterEre.allocationUnits - snapBeforeEre.allocationUnits,
    };
  }
  return { id: input.id, results };
}

class CooperativeWorker implements RegexWorker {
  readonly controller = new AbortController();
  readonly listeners = new Map<WorkerEvent, Set<Listener>>();
  private singleMessageListener: ((message: unknown) => void) | undefined;
  readonly tasks = new Set<Promise<void>>();
  busy = false;
  closing: Promise<void> | undefined;

  constructor(private readonly limits: Required<BoundedRegexProviderOptions>, private readonly release: () => void) {
    inProcessRegexWorkers.add(this);
    queueMicrotask(() => { if (!this.closing) this.emit({ ready: true }); });
  }

  on(event: WorkerEvent, listener: Listener): void {
    if (this.closing) return;
    let listeners = this.listeners.get(event);
    if (!listeners) { listeners = new Set(); this.listeners.set(event, listeners); }
    listeners.add(listener);
    if (event === "message") {
      this.singleMessageListener = listeners.size === 1 ? (listener as (message: unknown) => void) : undefined;
    }
  }

  off(event: WorkerEvent, listener: Listener): void {
    const listeners = this.listeners.get(event);
    listeners?.delete(listener);
    if (event === "message") {
      this.singleMessageListener = listeners?.size === 1 ? (listeners.values().next().value as (message: unknown) => void) : undefined;
    }
  }

  private emit(value: unknown): void {
    if (this.singleMessageListener !== undefined) {
      this.singleMessageListener(value);
      return;
    }
    const listeners = this.listeners.get("message");
    if (listeners) for (const listener of listeners) (listener as (message: unknown) => void)(value);
  }

  postMessage(input: RegexWorkerRequest): void {
    if (this.closing) throw new Error("bounded regex worker is closed");
    if (this.busy) throw new Error("bounded regex worker is busy");
    const isTrusted = trustedWorkerRequests.has(input);
    let id: number;
    let operation: unknown;
    let expression: boolean;
    if (isTrusted) {
      id = input.id;
      operation = (input.descriptor as { kind?: unknown })?.kind;
      expression = operation === "expr-match" || operation === "bre-search";
    } else {
      const identity = input !== null && typeof input === "object" ? Object.getOwnPropertyDescriptor(input, "id") : undefined;
      if (!identity || !("value" in identity) || !Number.isSafeInteger(identity.value) || identity.value < 1) fail("protocol", "invalid request identity");
      id = identity.value as number;
      const submitted = Object.getOwnPropertyDescriptor(input, "descriptor")?.value as unknown;
      operation = submitted !== null && typeof submitted === "object" ? Object.getOwnPropertyDescriptor(submitted, "kind")?.value : undefined;
      expression = operation === "expr-match" || operation === "bre-search";
    }
    let owned: OwnedRequest | OwnedGlobRequest | OwnedExprRequest | undefined;
    let failure: string | undefined;
    let category: ExprMatchError["category"] = "unsupported";
    try {
      owned = expression ? admitExpr(input, this.limits, this.controller.signal) : admit(input, this.limits, this.controller.signal);
    }
    catch (error) {
      if (!(error instanceof ExprMatchError || error instanceof PublicDiagnostic || error instanceof EreSyntaxError || error instanceof EreUnsupportedError || error instanceof EreProfileLimitError || error instanceof EreUsageUnknownError)) throw error;
      if (error instanceof ExprMatchError) category = error.category;
      failure = error.message.slice(0, 512);
    }
    // Only the in-process executor consumes private direct-match replies.
    // Public worker requests retain the wire protocol's owned span arrays.
    if (isTrusted && owned && !("subject" in owned) && owned.descriptor.kind !== "glob") {
      try {
        this.controller.signal.throwIfAborted();
        const syncReply = tryExecuteSync(owned as OwnedRequest, this.controller.signal);
        if (syncReply !== undefined) {
          owned = undefined;
          if (!this.closing) this.emit(syncReply);
          return;
        }
      } catch (error) {
        if (error instanceof ExprMatchError || error instanceof PublicDiagnostic || error instanceof EreSyntaxError || error instanceof EreUnsupportedError || error instanceof EreProfileLimitError || error instanceof EreUsageUnknownError) {
          const errReply: Reply = { id, error: error.message.slice(0, 512) };
          owned = undefined;
          if (!this.closing) this.emit(errReply);
          return;
        }
      }
      // Re-admit with fresh ledger if tryExecuteSync partially charged before bailing out
      try {
        owned = admit(input, this.limits, this.controller.signal, false);
      } catch (error) {
        if (error instanceof ExprMatchError || error instanceof PublicDiagnostic || error instanceof EreSyntaxError || error instanceof EreUnsupportedError || error instanceof EreProfileLimitError || error instanceof EreUsageUnknownError) {
          failure = error.message.slice(0, 512);
          owned = undefined;
        } else throw error;
      }
    }
    this.scheduleAsyncTask(id, operation, expression, owned, failure, category);
  }

  private scheduleAsyncTask(
    id: number,
    operation: unknown,
    expression: boolean,
    owned: OwnedRequest | OwnedGlobRequest | OwnedExprRequest | undefined,
    failure: string | undefined,
    category: ExprMatchError["category"],
  ): void {
    this.busy = true;
    const task = Promise.resolve().then(async () => {
      let reply: Reply | ExprMatchReply | BreSearchReply;
      try {
        this.controller.signal.throwIfAborted();
        reply = owned ? "subject" in owned ? await executeExpr(owned, this.controller.signal)
          : owned.descriptor.kind === "glob" ? await executeBoundedGlobs(owned as OwnedGlobRequest, this.controller.signal)
          : await execute(owned as OwnedRequest, this.controller.signal) : { id, error: failure! };
        if (owned && !("subject" in owned) && !("error" in reply)) {
          trustedWorkerReplies.add(reply);
        }
      } catch (error) {
        if (!(error instanceof ExprMatchError || error instanceof PublicDiagnostic || error instanceof EreSyntaxError || error instanceof EreUnsupportedError || error instanceof EreProfileLimitError || error instanceof EreUsageUnknownError)) {
          owned = undefined;
          this.busy = false;
          for (const listener of this.listeners.get("error") ?? []) (listener as (reason: unknown) => void)(error);
          return;
        }
        if (error instanceof ExprMatchError) category = error.category;
        reply = { id, error: error.message.slice(0, 512) };
      }
      if (expression && "error" in reply) reply = { id, operation: operation === "bre-search" ? "bre-search" : "expr-match", category, error: reply.error };
      // Clear request-owned payloads before notifying the consumer or allowing reuse.
      owned = undefined;
      this.busy = false;
      if (!this.closing) this.emit(reply);
    });
    this.tasks.add(task);
    void task.then(() => this.tasks.delete(task), () => this.tasks.delete(task));
  }

  terminate(): Promise<void> {
    if (!this.closing) {
      this.closing = Promise.allSettled([...this.tasks]).then(() => {
        this.listeners.clear();
        this.tasks.clear();
        this.release();
      });
      this.controller.abort(new Error("bounded regex worker terminated"));
    }
    return this.closing;
  }
}

/** Cooperative ASCII selection/globs, ASCII expr, and UTF-8 literals; not a native-worker/RSS sandbox. */
export function createBoundedRegexProvider(input: BoundedRegexProviderOptions = {}): BoundedRegexProvider {
  const limits = options(input);
  let active = 0;
  const provider: BoundedRegexProvider = Object.freeze({
    createWorker(): RegexWorker {
      if (active >= limits.maxWorkers) fail("limit", "worker count limit exceeded");
      active++;
      return new CooperativeWorker(limits, () => { active--; });
    },
  });
  inProcessRegexProviders.add(provider);
  return provider;
}
