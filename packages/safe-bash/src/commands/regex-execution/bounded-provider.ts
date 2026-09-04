import { EreLedger } from "./ere/limits.js";
import { compileEre } from "./ere/syntax.js";
import { matchEre } from "./ere/matcher.js";
import type { EreProgram } from "./ere/types.js";
import type { BoundedRegexProvider, RegexWorker, RegexWorkerRequest } from "./provider.js";
import type { ExprMatchReply, GrepDescriptor, Reply, Row, SearchDescriptor } from "./protocol.js";

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
}

const defaults: Required<BoundedRegexProviderOptions> = Object.freeze({
  maxWorkers: 2, maxPatterns: 32, maxPatternBytes: 8192, maxRows: 128,
  maxInputBytes: 65_536, maxResultBytes: 2048, maxWork: 2_000_000,
  maxAllocationUnits: 1_000_000, maxStates: 65_536,
});
const ceilings: Required<BoundedRegexProviderOptions> = Object.freeze({
  maxWorkers: 32, maxPatterns: 128, maxPatternBytes: 65_532, maxRows: 4096,
  maxInputBytes: 1_048_576, maxResultBytes: 65_536, maxWork: 33_554_432,
  maxAllocationUnits: 4_000_000, maxStates: 65_536,
});

type SelectionDescriptor = GrepDescriptor | SearchDescriptor;
interface OwnedRequest {
  readonly id: number;
  readonly descriptor: SelectionDescriptor;
  readonly rows: readonly Row[];
  readonly ledger: EreLedger;
}
type WorkerEvent = "message" | "error" | "messageerror" | "exit";
type Listener = ((value: unknown) => void) | ((error: Error) => void) | (() => void) | ((code: number) => void);
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const byteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!;
const byteOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!;
const byteBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!;

function fail(kind: "protocol" | "unsupported" | "limit", message: string): never {
  throw new Error(`bounded regex ${kind}: ${message}`);
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
  if (value.word || kind.value === "grep" && value.insensitive || kind.value === "rg" && value.case !== "sensitive") fail("unsupported", "only case-sensitive, non-word selection is supported");
  if (kind.value === "rg" && !value.fixed) fail("unsupported", "rg regex and Unicode modes are unsupported; use fixed ASCII patterns");
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
    if (row.all) fail("unsupported", "all-match enumeration is unsupported");
    const length = byteLength.call(row.bytes) as number;
    if (length > limits.maxInputBytes - bytes) fail("limit", "aggregate input byte limit exceeded");
    bytes += length;
  }
  const ledger = new EreLedger({ maxExpansionBytes: 1_048_576, maxExpansionFields: 8192 }, {
    patternBytes: limits.maxPatternBytes + 4, subjectBytes: limits.maxInputBytes,
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
    rows.push({ bytes: copy, all: false, terminated: row.terminated });
  }
  return { id: input.id, descriptor: ownedDescriptor, rows, ledger };
}

async function admitBre(pattern: string, ledger: EreLedger, signal: AbortSignal): Promise<void> {
  let bracket = -1;
  let member = false;
  let namedClass = false;
  for (let index = 0; index < pattern.length; index++) {
    ledger.charge("work", 1, signal);
    await ledger.checkpoint(signal);
    const character = pattern[index]!;
    if ("\\()+?{}|".includes(character)) fail("unsupported", "BRE escapes, groups and interval/operator extensions are unsupported; use grep -E");
    if (bracket >= 0) {
      if (index === bracket + 1 && character === "^") continue;
      if (namedClass) {
        if (character === "]" && pattern[index - 1] === ":") namedClass = false;
      } else if (character === "]" && member) bracket = -1;
      else if (character === "[" && pattern[index + 1] === ":") namedClass = true;
      member = true;
    } else if (character === "[") { bracket = index; member = false; }
    else if (character === "^" && index !== 0 || character === "$" && index !== pattern.length - 1) {
      fail("unsupported", "BRE anchors are supported only at record boundaries");
    } else if (character === "*" && (index === 0 || index === 1 && pattern[0] === "^")) {
      fail("unsupported", "BRE leading literal star is unsupported; use fixed matching");
    }
  }
}

async function execute(input: OwnedRequest, signal: AbortSignal): Promise<Reply> {
  const { descriptor: selected, rows, ledger } = input;
  const programs: EreProgram[] = [];
  for (const pattern of selected.patterns) {
    if (selected.kind === "grep" && !selected.fixed && !selected.extended) await admitBre(pattern, ledger, signal);
    if (selected.kind === "rg" && !selected.nullData && pattern.includes("\n")) fail("unsupported", "rg multiline matching is unsupported");
    ledger.charge("allocationUnits", (selected.whole ? 3 : 1) * 3 + 2, signal);
    const fragments = selected.whole
      ? [{ text: "^(", literal: false }, { text: pattern, literal: selected.fixed }, { text: ")$", literal: false }]
      : [{ text: pattern, literal: selected.fixed }];
    programs.push(await compileEre(fragments, ledger, signal));
  }
  const results: Float64Array[] = [];
  for (const row of rows) {
    // The admitted ASCII profile makes every character offset the original byte offset.
    ledger.charge("allocationUnits", row.bytes.length * 2 + 2, signal);
    const characters: string[] = [];
    for (const byte of row.bytes) {
      ledger.charge("work", 1, signal);
      if (byte === 0 || byte > 127) fail("unsupported", "subjects require non-NUL ASCII; Unicode and invalid UTF-8 are unsupported");
      characters.push(String.fromCharCode(byte));
      await ledger.checkpoint(signal);
    }
    const subject = characters.join("");
    let span: { readonly start: number; readonly end: number } | undefined;
    for (const program of programs) {
      const match = await matchEre(program, subject, ledger, signal);
      if (!match.matched) continue;
      const candidate = match.captures[0]!;
      if (selected.kind === "grep") { span = candidate; break; }
      // Fixed rg patterns select the first occurrence, breaking ties by pattern order.
      if (!span || candidate.start < span.start) span = candidate;
    }
    signal.throwIfAborted();
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
    const expression = submitted !== null && typeof submitted === "object" && Object.getOwnPropertyDescriptor(submitted, "kind")?.value === "expr-match";
    let owned: OwnedRequest | undefined;
    let failure: string | undefined;
    try { owned = admit(input, this.limits, this.#controller.signal); }
    catch (error) { failure = error instanceof Error ? error.message.slice(0, 512) : "bounded regex protocol: request admission failed"; }
    this.#busy = true;
    const task = Promise.resolve().then(async () => {
      let reply: Reply | ExprMatchReply;
      try {
        this.#controller.signal.throwIfAborted();
        reply = owned ? await execute(owned, this.#controller.signal) : { id, error: failure! };
      } catch (error) {
        reply = { id, error: error instanceof Error ? error.message.slice(0, 512) : "bounded regex request failed" };
      }
      if (expression && "error" in reply) reply = { id, operation: "expr-match", category: "unsupported", error: reply.error };
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

/** Cooperative non-NUL ASCII grep selection and fixed-rg provider; not a native-worker/RSS sandbox. */
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
