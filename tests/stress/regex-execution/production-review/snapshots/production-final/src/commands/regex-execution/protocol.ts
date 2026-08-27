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

export type Descriptor = GrepDescriptor | SearchDescriptor;
export interface Row { readonly bytes: Uint8Array; readonly all: boolean; readonly terminated: boolean }
export interface Match { readonly start: number; readonly end: number }
export interface Request { readonly id: number; readonly descriptor: Descriptor; readonly rows: readonly Row[] }
export type Reply = { readonly id: number; readonly results: readonly Float64Array[] } | { readonly id: number; readonly error: string };

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
  let total = 128;
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
  return reply.results.map((ranges: unknown, index: number) => {
    signal.throwIfAborted();
    if (!(ranges instanceof Float64Array) || ranges.length % 2) throw new RegexExecutionError("PROTOCOL", "invalid match ranges");
    const result: Match[] = [];
    const row = rows[index]!;
    if (!row.all && ranges.length > 2) throw new RegexExecutionError("PROTOCOL", "unexpected multiple matches");
    for (let offset = 0; offset < ranges.length; offset += 2) {
      signal.throwIfAborted();
      const start = ranges[offset]!;
      const end = ranges[offset + 1]!;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > row.bytes.length || start < (result.at(-1)?.start ?? 0)) throw new RegexExecutionError("PROTOCOL", "invalid match bounds");
      result.push({ start, end });
    }
    return result;
  });
}
