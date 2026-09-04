export interface RegexExecutionOptions {
  readonly requestTimeoutMs?: number;
  readonly startupTimeoutMs?: number;
  readonly maxWorkers?: number;
  readonly maxQueuedRequests?: number;
  readonly maxQueuedBytes?: number;
  readonly idleTimeoutMs?: number;
  readonly workerOldGenerationMb?: number;
  readonly workerStackMb?: number;
}

export const defaults: Required<RegexExecutionOptions> = Object.freeze({
  requestTimeoutMs: 1000, startupTimeoutMs: 3000, maxWorkers: 2,
  maxQueuedRequests: 64, maxQueuedBytes: 128 * 1024 * 1024,
  idleTimeoutMs: 100, workerOldGenerationMb: 128, workerStackMb: 4,
});

export type RegexErrorCode = "QUEUE_EXHAUSTED" | "REQUEST_TIMEOUT" | "STARTUP_TIMEOUT" | "WORKER_EXIT" | "WORKER_ERROR" | "PROTOCOL" | "CLOSED" | "MATCH";

export class RegexExecutionError extends Error {
  constructor(readonly code: RegexErrorCode, message: string) {
    super(code === "MATCH" ? message : `regex ${code}: ${message}`);
    this.name = "RegexExecutionError";
  }
}

export interface GrepDescriptor {
  readonly kind: "grep";
  readonly patterns: readonly string[];
  readonly fixed: boolean;
  readonly extended: boolean;
  readonly insensitive: boolean;
  readonly whole: boolean;
  readonly word: boolean;
}

export interface SearchDescriptor {
  readonly kind: "rg";
  readonly patterns: readonly string[];
  readonly fixed: boolean;
  readonly case: "sensitive" | "insensitive" | "smart";
  readonly whole: boolean;
  readonly word: boolean;
  readonly nullData: boolean;
}

export interface GlobDescriptor {
  readonly kind: "glob";
  readonly patterns: readonly string[];
  readonly globOptions: readonly { readonly insensitive: boolean; readonly literalUnclosedClass: boolean }[];
}

export type Descriptor = GrepDescriptor | SearchDescriptor | GlobDescriptor;
export interface Row { readonly bytes: Uint8Array; readonly all: boolean; readonly terminated: boolean; readonly directory?: boolean; readonly ancestors?: boolean }
export interface Match { readonly start: number; readonly end: number }
export const matchRangeLimits = Object.freeze({ perRow: 100_000, perReply: 100_000 });
export interface Request { readonly id: number; readonly descriptor: Descriptor; readonly rows: readonly Row[] }
export type Reply = { readonly id: number; readonly results: readonly Float64Array[] } | { readonly id: number; readonly error: string };

export interface ExprMatchLimits {
  readonly maxPatternBytes: number;
  readonly maxSubjectBytes: number;
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly maxSteps: number;
  readonly maxStates: number;
  readonly maxAllocatedUnits: number;
}
export const exprMatchCeilings: ExprMatchLimits = Object.freeze({
  maxPatternBytes: 65_536, maxSubjectBytes: 1_048_576, maxNodes: 8192,
  maxDepth: 128, maxSteps: 50_000_000, maxStates: 65_536, maxAllocatedUnits: 4_000_000,
});
export interface ExprMatchDescriptor {
  readonly kind: "expr-match";
  readonly pattern: Uint8Array;
  readonly profile: "byte" | "utf8-scalar";
  readonly limits: ExprMatchLimits;
}
export interface ExprMatchResult {
  readonly offsetUnit: "byte";
  readonly matched: boolean;
  readonly hasCapture: boolean;
  readonly overall: Match | null;
  readonly capture: Match | null;
  readonly steps: number;
}
export interface ExprMatchRequest { readonly id: number; readonly descriptor: ExprMatchDescriptor; readonly rows: readonly Row[] }
export type ExprMatchReply = { readonly id: number; readonly operation: "expr-match"; readonly result: ExprMatchResult }
  | { readonly id: number; readonly operation: "expr-match"; readonly error: string; readonly category: "syntax" | "unsupported" | "limit" };

export class ExprMatchError extends Error {
  constructor(readonly category: "syntax" | "unsupported" | "limit", message: string) { super(message); }
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function validateExprInput(descriptor: ExprMatchDescriptor, rows: readonly Row[], signal: AbortSignal): void {
  signal.throwIfAborted();
  const invalid = () => { throw new RegexExecutionError("PROTOCOL", "invalid expr request"); };
  if (!exactObject(descriptor, ["kind", "pattern", "profile", "limits"]) || descriptor.kind !== "expr-match"
    || !(descriptor.pattern instanceof Uint8Array) || !["byte", "utf8-scalar"].includes(descriptor.profile)) invalid();
  const keys = Object.keys(exprMatchCeilings) as (keyof ExprMatchLimits)[];
  if (!exactObject(descriptor.limits, keys)) invalid();
  for (const key of keys) {
    if (!Number.isSafeInteger(descriptor.limits[key]) || descriptor.limits[key] < 1 || descriptor.limits[key] > exprMatchCeilings[key]) invalid();
  }
  if (!Array.isArray(rows) || rows.length !== 1) invalid();
  const row = rows[0]!;
  if (!exactObject(row, ["bytes", "all", "terminated"]) || !(row.bytes instanceof Uint8Array) || row.all !== false || row.terminated !== false) invalid();
  if (descriptor.pattern.length > descriptor.limits.maxPatternBytes || row.bytes.length > descriptor.limits.maxSubjectBytes) {
    throw new ExprMatchError("limit", "regex input bytes limit exceeded");
  }
}

export function validateExprRequest(value: unknown): asserts value is ExprMatchRequest {
  if (!exactObject(value, ["id", "descriptor", "rows"]) || !Number.isSafeInteger(value.id) || (value.id as number) < 1) {
    throw new RegexExecutionError("PROTOCOL", "invalid expr request identity");
  }
  validateExprInput(value.descriptor as ExprMatchDescriptor, value.rows as readonly Row[], new AbortController().signal);
}

export function validateExprReply(value: unknown, id: number, descriptor: ExprMatchDescriptor, subject: Uint8Array, signal: AbortSignal): ExprMatchResult {
  signal.throwIfAborted();
  const invalid = (): never => { throw new RegexExecutionError("PROTOCOL", "invalid expr reply"); };
  if (!value || typeof value !== "object") return invalid();
  const reply = value as Record<string, unknown>;
  if (reply.id !== id || reply.operation !== "expr-match") return invalid();
  if ("error" in reply) {
    if (!exactObject(reply, ["id", "operation", "error", "category"]) || typeof reply.error !== "string"
      || reply.error.length > 512 || !["syntax", "unsupported", "limit"].includes(reply.category as string)) return invalid();
    throw new ExprMatchError(reply.category as "syntax" | "unsupported" | "limit", reply.error);
  }
  if (!exactObject(reply, ["id", "operation", "result"])) return invalid();
  const result = reply.result;
  if (!exactObject(result, ["offsetUnit", "matched", "hasCapture", "overall", "capture", "steps"])
    || result.offsetUnit !== "byte" || typeof result.matched !== "boolean" || typeof result.hasCapture !== "boolean"
    || !Number.isSafeInteger(result.steps) || (result.steps as number) < 1 || (result.steps as number) > descriptor.limits.maxSteps) return invalid();
  const span = (value: unknown): Match | null => {
    if (value === null) return null;
    if (!exactObject(value, ["start", "end"]) || !Number.isSafeInteger(value.start) || !Number.isSafeInteger(value.end)) return invalid();
    const start = value.start as number, end = value.end as number;
    if (start < 0 || end < start || end > subject.length) return invalid();
    if (descriptor.profile === "utf8-scalar") {
      for (const offset of [start, end]) if (offset < subject.length && subject[offset]! >= 0x80 && subject[offset]! <= 0xbf) return invalid();
    }
    return { start, end };
  };
  const overall = span(result.overall), capture = span(result.capture);
  if (result.matched !== (overall !== null) || overall && overall.start !== 0
    || capture && (!result.hasCapture || !overall || capture.start < overall.start || capture.end > overall.end)) return invalid();
  return { offsetUnit: "byte", matched: result.matched, hasCapture: result.hasCapture, overall, capture, steps: result.steps as number };
}

export function policy(options: RegexExecutionOptions): Required<RegexExecutionOptions> {
  const result = { ...defaults, ...options };
  for (const key of Object.keys(defaults) as (keyof RegexExecutionOptions)[]) {
    const minimum = key === "maxQueuedRequests" || key === "maxQueuedBytes" ? 0 : 1;
    if (!Number.isSafeInteger(result[key]) || result[key] < minimum) throw new RangeError(`regex ${key} must be a safe integer >= ${minimum}`);
  }
  for (const key of ["requestTimeoutMs", "startupTimeoutMs", "idleTimeoutMs"] as const) {
    if (result[key] > 2147483647) throw new RangeError(`regex ${key} exceeds the Node timer range`);
  }
  return Object.freeze(result);
}

export function inputBytes(descriptor: Descriptor, rows: readonly Row[], signal: AbortSignal): number {
  let total = 128 + (descriptor.kind === "glob" ? descriptor.globOptions.length * 32 : 0);
  for (const pattern of descriptor.patterns) {
    signal.throwIfAborted();
    total += 16 + pattern.length * 2;
    if (!Number.isSafeInteger(total)) throw new RegexExecutionError("QUEUE_EXHAUSTED", "input accounting overflow");
  }
  for (const row of rows) {
    signal.throwIfAborted();
    total += 32 + row.bytes.byteLength;
    if (!Number.isSafeInteger(total)) throw new RegexExecutionError("QUEUE_EXHAUSTED", "input accounting overflow");
  }
  return total;
}

export function validateReply(value: unknown, id: number, rows: readonly Row[], signal: AbortSignal): Match[][] {
  signal.throwIfAborted();
  const reply = value as Partial<Reply> | undefined;
  if (!reply || typeof reply !== "object" || reply.id !== id) throw new RegexExecutionError("PROTOCOL", "invalid reply identity");
  if ("error" in reply) {
    if (typeof reply.error !== "string") throw new RegexExecutionError("PROTOCOL", "invalid error reply");
    throw new RegexExecutionError("MATCH", reply.error);
  }
  if (!("results" in reply) || !Array.isArray(reply.results) || reply.results.length !== rows.length) throw new RegexExecutionError("PROTOCOL", "invalid reply rows");
  let total = 0;
  const lengths: number[] = [];
  for (let index = 0; index < reply.results.length; index++) {
    signal.throwIfAborted();
    const ranges: unknown = reply.results[index];
    const row = rows[index]!;
    if (!(ranges instanceof Float64Array)) throw new RegexExecutionError("PROTOCOL", "invalid match ranges");
    const length = ranges.length;
    if (length % 2 || length > 2 * (row.bytes.length + 1)) throw new RegexExecutionError("PROTOCOL", "invalid match ranges");
    if (!row.all && length > 2) throw new RegexExecutionError("PROTOCOL", "unexpected multiple matches");
    const count = length / 2;
    if (count > matchRangeLimits.perRow || count > matchRangeLimits.perReply - total) throw new RegexExecutionError("PROTOCOL", "match range limit exceeded");
    total += count;
    lengths.push(length);
  }
  const results = reply.results.map((ranges: Float64Array, index: number) => {
    signal.throwIfAborted();
    const length = lengths[index]!;
    if (ranges.length !== length) throw new RegexExecutionError("PROTOCOL", "match ranges changed after admission");
    const result: Match[] = [];
    const row = rows[index]!;
    for (let offset = 0; offset < length; offset += 2) {
      signal.throwIfAborted();
      const start = ranges[offset]!;
      const end = ranges[offset + 1]!;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > row.bytes.length || start < (result.at(-1)?.start ?? 0)) throw new RegexExecutionError("PROTOCOL", "invalid match bounds");
      result.push({ start, end });
    }
    return result;
  });
  for (let index = 0; index < reply.results.length; index++) {
    signal.throwIfAborted();
    if (reply.results[index]!.length !== lengths[index]) throw new RegexExecutionError("PROTOCOL", "match ranges changed after admission");
  }
  return results;
}
