import { shellValueByteLength, shellValueBytes, shellValueText } from "../contracts/value.js";
import type { ShellValue, ValueAllocation } from "../contracts/value.js";
import { latin1Text } from "../byte-encoding.js";

export interface GetoptsInput {
  readonly args: readonly ShellValue[];
}

const ownedInputs = new WeakMap<GetoptsInput, { bytes?: number; ascii?: boolean }>();

export function getoptsInputAllocationSize(argumentsCount: number): { bytes: number; slots: number } {
  return { bytes: 256 + argumentsCount * 8, slots: argumentsCount + 2 };
}

export async function createGetoptsInput(args: readonly ShellValue[], allocation: ValueAllocation | undefined, controls: GetoptsWork): Promise<GetoptsInput> {
  const work = new ScanWork(controls);
  if (!Array.isArray(args)) throw new GetoptsError("INVALID_INPUT", "Getopts requires an argument array");
  const length = args.length;
  if (length > work.maxArguments) throw new GetoptsError("ARGUMENT_LIMIT", "Getopts argument limit exceeded");
  const size = getoptsInputAllocationSize(length);
  const reservation = allocation?.reserve(size.bytes, size.slots);
  try {
    const snapshot: ShellValue[] = [];
    for (let index = 0; index < length; index++) {
      const waiting = work.step();
      if (waiting) await waiting;
      snapshot.push(args[index]!);
    }
    await work.flush();
    if (args.length !== length) throw new GetoptsError("INVALID_INPUT", "Getopts argument extent changed during admission");
    const input = Object.freeze({ args: Object.freeze(snapshot) });
    reservation?.commit(input);
    ownedInputs.set(input, {});
    return input;
  } catch (error) {
    try { reservation?.release(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "Getopts input allocation and release failed"); }
    throw error;
  }
}

export interface GetoptsState {
  readonly index: number;
  readonly active?: { readonly argument: number; readonly offset: number };
}

export interface GetoptsWork {
  readonly maxArguments: number;
  readonly maxBytes: number;
  readonly maxSteps: number;
  readonly yieldEvery: number;
  readonly signal?: AbortSignal;
  readonly checkpoint: (steps: number) => void | Promise<void>;
}

export interface GetoptsScanOptions {
  readonly reportErrors: boolean;
  readonly work: GetoptsWork;
}

export type GetoptsDiagnostic = {
  readonly kind: "unknown-option" | "missing-argument";
  readonly option: string;
};

export interface GetoptsScanResult {
  readonly state: GetoptsState;
  readonly kind: "option" | "unknown-option" | "missing-argument" | "end";
  readonly status: 0 | 1;
  readonly option: string;
  readonly optind: number;
  readonly argument: { readonly kind: "set"; readonly value: string } | { readonly kind: "unset" };
  /** Original operand and byte offset for a required option argument. */
  readonly argumentSource?: { readonly index: number; readonly offset: number };
  readonly diagnostic: GetoptsDiagnostic | null;
}

export class GetoptsError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "ARGUMENT_LIMIT" | "BYTE_LIMIT" | "STEP_LIMIT", message: string) {
    super(message);
    this.name = "GetoptsError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, minimum: number, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new GetoptsError("INVALID_INPUT", `${name} must be a safe integer >= ${minimum}`);
  }
}

export function createGetoptsState(): GetoptsState {
  return { index: 0 };
}

export function cloneGetoptsState(state: GetoptsState): GetoptsState {
  if (!record(state)) throw new GetoptsError("INVALID_INPUT", "Invalid getopts state");
  integer(state.index, 0, "index");
  if (state.active === undefined) return { index: state.index };
  if (!record(state.active)) throw new GetoptsError("INVALID_INPUT", "Invalid getopts active cursor");
  integer(state.active.argument, 0, "active.argument");
  integer(state.active.offset, 1, "active.offset");
  return { index: state.index, active: { argument: state.active.argument, offset: state.active.offset } };
}

export function withGetoptsIndex(state: GetoptsState, index: number): GetoptsState {
  const copy = cloneGetoptsState(state);
  integer(index, Number.MIN_SAFE_INTEGER, "index");
  return index <= 1 ? createGetoptsState() : { ...copy, index };
}

class ScanWork {
  private steps = 0;
  private pending = 0;
  private bytes = 0;
  readonly maxArguments: number;
  private readonly maxBytes: number;
  private readonly maxSteps: number;
  private readonly yieldEvery: number;
  private readonly signal: AbortSignal | undefined;
  private readonly checkpoint: GetoptsWork["checkpoint"];

  constructor(work: GetoptsWork) {
    if (!record(work)) throw new GetoptsError("INVALID_INPUT", "Explicit getopts work controls are required");
    integer(work.maxArguments, 0, "maxArguments");
    integer(work.maxBytes, 0, "maxBytes");
    integer(work.maxSteps, 0, "maxSteps");
    integer(work.yieldEvery, 1, "yieldEvery");
    if (typeof work.checkpoint !== "function") throw new GetoptsError("INVALID_INPUT", "A getopts checkpoint is required");
    if (work.signal !== undefined && (!record(work.signal) || typeof work.signal.throwIfAborted !== "function" || typeof work.signal.addEventListener !== "function" || typeof work.signal.removeEventListener !== "function")) {
      throw new GetoptsError("INVALID_INPUT", "Invalid getopts signal");
    }
    this.maxArguments = work.maxArguments;
    this.maxBytes = work.maxBytes;
    this.maxSteps = work.maxSteps;
    this.yieldEvery = work.yieldEvery;
    this.signal = work.signal;
    this.checkpoint = work.checkpoint;
    this.check();
  }

  check(): void {
    this.signal?.throwIfAborted();
  }

  get inputBytes(): number { return this.bytes; }

  step(): Promise<void> | undefined {
    this.check();
    if (this.steps === this.maxSteps) throw new GetoptsError("STEP_LIMIT", "Getopts work step limit exceeded");
    this.steps++;
    this.pending++;
    return this.pending === this.yieldEvery ? this.flush() : undefined;
  }

  addBytes(count: number): void {
    if (count > this.maxBytes - this.bytes) throw new GetoptsError("BYTE_LIMIT", "Getopts input byte limit exceeded");
    this.bytes += count;
  }

  async flush(): Promise<void> {
    this.check();
    if (this.pending) {
      const steps = this.pending;
      this.pending = 0;
      const pending = Promise.resolve(this.checkpoint(steps));
      const signal = this.signal;
      if (!signal) await pending;
      else await new Promise<void>((resolve, reject) => {
        const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
        pending.then(
          () => { signal.removeEventListener("abort", abort); resolve(); },
          error => { signal.removeEventListener("abort", abort); reject(error); },
        );
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    }
    this.check();
  }
}

async function validateString(value: unknown, work: ScanWork): Promise<boolean> {
  if (typeof value !== "string") {
    let length: number;
    try { length = shellValueByteLength(value as ShellValue); }
    catch { throw new GetoptsError("INVALID_INPUT", "Getopts requires shell values"); }
    work.addBytes(length);
    for (const byte of shellValueBytes(value as ShellValue)) {
      const waiting = work.step();
      if (waiting) await waiting;
      if (byte === 0) throw new GetoptsError("INVALID_INPUT", "Getopts inputs must not contain NUL");
    }
    return false;
  }
  let ascii = true;
  for (let position = 0; position < value.length; position++) {
    const waiting = work.step();
    if (waiting) await waiting;
    const code = value.charCodeAt(position);
    if (code > 127) ascii = false;
    if (code === 0) throw new GetoptsError("INVALID_INPUT", "Getopts inputs must not contain NUL");
    if (code < 128) work.addBytes(1);
    else if (code < 2048) work.addBytes(2);
    else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(position + 1) >= 0xdc00 && value.charCodeAt(position + 1) <= 0xdfff) work.addBytes(4);
    else if (code >= 0xdc00 && code <= 0xdfff && value.charCodeAt(position - 1) >= 0xd800 && value.charCodeAt(position - 1) <= 0xdbff) work.addBytes(0);
    else work.addBytes(3);
  }
  return ascii;
}

// Byte strings keep cursor offsets and single-byte option results independent of UTF-8 decoding.
function byteText(value: ShellValue): string {
  if (typeof value === "string") {
    let index = 0;
    while (index < value.length && value.charCodeAt(index) < 128) index++;
    if (index === value.length) return value;
  }
  return latin1Text(shellValueBytes(value));
}

export async function scanGetopts(state: GetoptsState, optstring: ShellValue, input: readonly ShellValue[] | GetoptsInput, options: GetoptsScanOptions): Promise<GetoptsScanResult> {
  if (!record(options) || typeof options.reportErrors !== "boolean") throw new GetoptsError("INVALID_INPUT", "Getopts requires explicit diagnostic policy and work controls");
  const work = new ScanWork(options.work);
  const original = cloneGetoptsState(state);
  const owned = ownedInputs.get(input as GetoptsInput);
  const args: readonly ShellValue[] = owned ? (input as GetoptsInput).args : input as readonly ShellValue[];
  if (!Array.isArray(args)) throw new GetoptsError("INVALID_INPUT", "Getopts requires an argument array");
  if (args.length > work.maxArguments) throw new GetoptsError("ARGUMENT_LIMIT", "Getopts argument limit exceeded");
  const starting = work.step();
  if (starting) await starting;
  await validateString(optstring, work);
  const specificationBytes = work.inputBytes;
  let ascii = owned?.ascii ?? true;
  if (owned?.bytes !== undefined) work.addBytes(owned.bytes);
  else {
    for (let argument = 0; argument < args.length; argument++) {
      const waiting = work.step();
      if (waiting) await waiting;
      if (!await validateString(args[argument], work)) ascii = false;
    }
  }
  const spec = byteText(optstring);
  const silent = spec.startsWith(":");
  const specification = new Int8Array(256).fill(-1);
  for (let position = silent ? 1 : 0; position < spec.length; position++) {
    const waiting = work.step();
    if (waiting) await waiting;
    const code = spec.charCodeAt(position);
    if (code !== 58 && code !== 63 && specification[code] === -1) specification[code] = Number(spec[position + 1] === ":");
  }
  let index = original.index || 1;
  let active = original.index === 0 ? undefined : original.active;
  const finish = async (kind: GetoptsScanResult["kind"], option: string, argument: GetoptsScanResult["argument"], diagnostic: GetoptsDiagnostic | null, argumentSource?: GetoptsScanResult["argumentSource"]): Promise<GetoptsScanResult> => {
    // Bash's recognized 0xff option collides with its signed-char EOF sentinel.
    if (kind === "option" && option.charCodeAt(0) === 255) {
      kind = "end";
      option = "?";
      argument = { kind: "unset" };
      argumentSource = undefined;
    }
    const waiting = work.step();
    if (waiting) await waiting;
    await work.flush();
    if (owned) { owned.bytes = work.inputBytes - specificationBytes; owned.ascii = ascii; }
    return { state: active === undefined ? { index } : { index, active: { ...active } }, kind, status: kind === "end" ? 1 : 0, option, optind: index, argument, diagnostic, ...(argumentSource ? { argumentSource } : {}) };
  };
  const end = (): Promise<GetoptsScanResult> => {
    active = undefined;
    return finish("end", "?", { kind: "unset" }, null);
  };
  if (index > args.length) {
    index = args.length + 1;
    // Bash retains the cluster cursor when a helper has no remaining arguments.
    return finish("end", "?", { kind: "unset" }, null);
  }
  if (active && (args[active.argument] === undefined || active.offset >= (ascii ? (args[active.argument] as string).length : shellValueByteLength(args[active.argument]!)))) active = undefined;
  if (!active) {
    const token = ascii ? args[index - 1] as string : byteText(args[index - 1]!);
    if (token.length < 2 || token[0] !== "-") return end();
    if (token === "--") {
      index++;
      // Bash retains the prior cluster cursor across an explicit end marker.
      active = original.index === 0 ? undefined : original.active;
      return finish("end", "?", { kind: "unset" }, null);
    }
    active = { argument: index - 1, offset: 1 };
  }
  const token = ascii ? args[active.argument] as string : byteText(args[active.argument]!);
  const option = token[active.offset]!;
  const code = option.charCodeAt(0);
  const offset = active.offset + 1;
  const attached = offset < token.length;
  active = attached ? { argument: active.argument, offset } : undefined;
  if (!attached) index++;
  if (specification[code] === -1) {
    return finish("unknown-option", "?", silent ? { kind: "set", value: option } : { kind: "unset" }, !silent && options.reportErrors ? { kind: "unknown-option", option } : null);
  }
  if (specification[code] === 1) {
    if (attached) {
      const source = { index: active!.argument, offset };
      active = undefined;
      index++;
      const original = args[source.index]!;
      const prefix = shellValueText(original).slice(0, offset);
      const value = typeof original === "string" && byteText(prefix) === prefix ? original.slice(offset)
        : new TextDecoder("utf-8", { ignoreBOM: true }).decode(shellValueBytes(original).subarray(offset));
      return finish("option", option, { kind: "set", value }, null, source);
    }
    if (index <= args.length) {
      const value = shellValueText(args[index - 1]!);
      index++;
      return finish("option", option, { kind: "set", value }, null, { index: index - 2, offset: 0 });
    }
    return finish("missing-argument", silent ? ":" : "?", silent ? { kind: "set", value: option } : { kind: "unset" }, !silent && options.reportErrors ? { kind: "missing-argument", option } : null);
  }
  return finish("option", option, { kind: "unset" }, null);
}

const syncSpecScratch = new Int8Array(128);

export function scanGetoptsSync(state: GetoptsState, optstring: string, args: readonly string[]): GetoptsScanResult | undefined {
  if (!record(state) || typeof state.index !== "number" || !Number.isSafeInteger(state.index) || state.index < 0 || args.length > 1024 || optstring.length > 256) return undefined;
  for (let i = 0; i < optstring.length; i++) {
    const c = optstring.charCodeAt(i);
    if (c === 0 || c > 127) return undefined;
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.length > 4096 || a.includes("\0")) return undefined;
    if (i !== (state.active?.argument ?? (state.index || 1) - 1)) continue;
    // This path publishes strings only; a byte cursor inside a UTF-8 cluster needs the checked path.
    const prefix = state.active?.argument === i ? state.active.offset + 1 : 2;
    for (let position = 0; position < Math.min(prefix, a.length); position++) {
      if (a.charCodeAt(position) > 127) return undefined;
    }
  }
  const silent = optstring.charCodeAt(0) === 58;
  syncSpecScratch.fill(-1);
  for (let position = silent ? 1 : 0; position < optstring.length; position++) {
    const code = optstring.charCodeAt(position);
    if (code !== 58 && code !== 63 && syncSpecScratch[code] === -1) syncSpecScratch[code] = Number(optstring.charCodeAt(position + 1) === 58);
  }
  let index = state.index || 1;
  let active = state.index === 0 ? undefined : state.active;
  if (index > args.length) {
    index = args.length + 1;
    // Bash retains the cluster cursor when a helper has no remaining arguments.
    return { state: active === undefined ? { index } : { index, active: { ...active } }, kind: "end", status: 1, option: "?", optind: index, argument: { kind: "unset" }, diagnostic: null };
  }
  if (active && (args[active.argument] === undefined || active.offset >= args[active.argument]!.length)) active = undefined;
  if (!active) {
    const token = args[index - 1]!;
    if (token.length < 2 || token.charCodeAt(0) !== 45) {
      return { state: { index }, kind: "end", status: 1, option: "?", optind: index, argument: { kind: "unset" }, diagnostic: null };
    }
    if (token === "--") {
      index++;
      // Bash retains the prior cluster cursor across an explicit end marker.
      active = state.index === 0 ? undefined : state.active;
      return { state: active === undefined ? { index } : { index, active: { ...active } }, kind: "end", status: 1, option: "?", optind: index, argument: { kind: "unset" }, diagnostic: null };
    }
    active = { argument: index - 1, offset: 1 };
  }
  const token = args[active.argument]!;
  const option = token[active.offset]!;
  const code = option.charCodeAt(0);
  if (code > 127) return undefined;
  const offset = active.offset + 1;
  const attached = offset < token.length;
  active = attached ? { argument: active.argument, offset } : undefined;
  if (!attached) index++;
  if (syncSpecScratch[code] === -1) {
    if (!silent) return undefined;
    return { state: active === undefined ? { index } : { index, active }, kind: "unknown-option", status: 0, option: "?", optind: index, argument: { kind: "set", value: option }, diagnostic: null };
  }
  if (syncSpecScratch[code] === 1) {
    if (attached) {
      index++;
      return { state: { index }, kind: "option", status: 0, option, optind: index, argument: { kind: "set", value: token.slice(offset) }, argumentSource: { index: active!.argument, offset }, diagnostic: null };
    }
    if (index <= args.length) {
      const value = args[index - 1]!;
      index++;
      return { state: active === undefined ? { index } : { index, active }, kind: "option", status: 0, option, optind: index, argument: { kind: "set", value }, argumentSource: { index: index - 2, offset: 0 }, diagnostic: null };
    }
    if (!silent) return undefined;
    return { state: active === undefined ? { index } : { index, active }, kind: "missing-argument", status: 0, option: ":", optind: index, argument: { kind: "set", value: option }, diagnostic: null };
  }
  return { state: active === undefined ? { index } : { index, active }, kind: "option", status: 0, option, optind: index, argument: { kind: "unset" }, diagnostic: null };
}
