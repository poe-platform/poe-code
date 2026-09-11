import { yieldTurn } from "../../contracts/yield.js";
import { Interpreter } from "./interpreter.js";
import {
  Budget,
  JqLimitError,
  objectKeys,
  wellFormed,
  type JqLimits,
  type Json,
} from "./limits.js";
import { Decimal, isNumber, numberText } from "./numbers.js";
import { parse, type Ast } from "./parser.js";

const checkpointWidth = 1023;

const yqQueryLimits: Readonly<JqLimits> = Object.freeze({
  maxInputBytes: 16_000_000,
  maxValueBytes: 8_388_608,
  maxOutputBytes: 16_777_216,
  maxSourceBytes: 8_192,
  maxDepth: 128,
  maxAstDepth: 64,
  maxSteps: 1_000_000,
  maxResults: 100_000,
  maxCollectionSize: 100_000,
});

export type YqValueFailureCode =
  | "ENCODE_UNSUPPORTED_VALUE"
  | "ENCODE_INVALID_UNICODE"
  | "ENCODE_CYCLIC_GRAPH"
  | "SCHEMA_NONFINITE_NUMBER"
  | "SCHEMA_UNSAFE_INTEGER";

export class YqValueFailure extends Error {
  constructor(readonly code: YqValueFailureCode) {
    super(code);
  }
}

export interface YqPrepaidWork {
  beforeUnit(): Promise<void>;
  finish(): void;
  abandon(): void;
}

export interface YqOwnedWork {
  charge(units?: number): Promise<void>;
  admitInputBytes(bytes: number): void;
  admitOutputBytes(bytes: number): void;
  admitResult(): void;
  measure(value: Json): Promise<number>;
  stringifyJson(value: Json, options: {
    readonly pretty: boolean;
    readonly maxBytes: number;
    readonly limitName: "maxValueBytes" | "maxOutputBytes";
  }): Promise<string>;
  reserve(ordinaryUnits: number): YqPrepaidWork;
  assertOpen(): void;
}

export interface YqQuerySession {
  readonly ownedWork: YqOwnedWork;
  compileOnce(source: string): void;
  run(input: Json): AsyncGenerator<Json, void, undefined>;
  close(): Promise<void>;
}

function assertNonnegativeSafe(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a nonnegative safe integer`);
}

function checkedAdd(current: number, incoming: number, limitName: keyof JqLimits, limit: number): number {
  assertNonnegativeSafe(incoming, "count");
  if (incoming > limit - current) throw new JqLimitError(limitName);
  return current + incoming;
}

function throwSignal(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}

function scalarBytes(value: null | boolean | number | Decimal): number {
  return Buffer.byteLength(isNumber(value) ? numberText(value) : JSON.stringify(value));
}

function validateNumber(value: number | Decimal): void {
  const numeric = value instanceof Decimal ? value.double : value;
  if (!Number.isFinite(numeric)) throw new YqValueFailure("SCHEMA_NONFINITE_NUMBER");
  if (Number.isInteger(numeric) && !Number.isSafeInteger(numeric)) {
    throw new YqValueFailure("SCHEMA_UNSAFE_INTEGER");
  }
}

function jsonEscape(codePoint: number): string {
  if (codePoint === 0x22) return "\\\"";
  if (codePoint === 0x5c) return "\\\\";
  if (codePoint === 0x08) return "\\b";
  if (codePoint === 0x0c) return "\\f";
  if (codePoint === 0x0a) return "\\n";
  if (codePoint === 0x0d) return "\\r";
  if (codePoint === 0x09) return "\\t";
  if (codePoint < 0x20) return `\\u${codePoint.toString(16).padStart(4, "0")}`;
  return String.fromCodePoint(codePoint);
}

function jsonEscapedBytes(codePoint: number): number {
  if (codePoint < 0x20 && ![0x08, 0x09, 0x0a, 0x0c, 0x0d].includes(codePoint)) return 6;
  if (codePoint === 0x22 || codePoint === 0x5c || codePoint === 0x08 || codePoint === 0x09
    || codePoint === 0x0a || codePoint === 0x0c || codePoint === 0x0d) return 2;
  return codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
}

interface OwnedState {
  pending: number;
  activeReservation: boolean;
  accepting: boolean;
  terminal: boolean;
}

class OwnedWork implements YqOwnedWork {
  readonly #budget: Budget;
  readonly #signal: AbortSignal;
  readonly #state: OwnedState = { pending: 0, activeReservation: false, accepting: true, terminal: false };
  readonly #active = new Set<Promise<unknown>>();
  #activeAbandon: (() => void) | undefined;

  constructor(budget: Budget, signal: AbortSignal) {
    this.#budget = budget;
    this.#signal = signal;
  }

  assertOpen(): void {
    throwSignal(this.#signal);
    if (!this.#state.accepting || this.#state.terminal) throw new Error("yq query session is closed");
  }

  async charge(units = 1): Promise<void> {
    return this.#track(this.#charge(units));
  }

  async #charge(units = 1): Promise<void> {
    if (!Number.isSafeInteger(units) || units <= 0) throw new RangeError("units must be a positive safe integer");
    this.assertOpen();
    if (this.#state.activeReservation) throw new Error("owned work cannot interleave with a prepaid reservation");
    let remaining = units;
    while (remaining > 0) {
      this.assertOpen();
      if (this.#state.pending === checkpointWidth) {
        try {
          await this.#budget.tick();
        } catch (failure) {
          throwSignal(this.#signal);
          throw failure;
        }
        this.assertOpen();
        this.#state.pending = 0;
      }
      const admitted = Math.min(remaining, checkpointWidth - this.#state.pending);
      this.#budget.step(admitted);
      this.#state.pending += admitted;
      remaining -= admitted;
    }
  }

  admitInputBytes(bytes: number): void {
    this.assertOpen();
    this.#budget.inputBytes = checkedAdd(this.#budget.inputBytes, bytes, "maxInputBytes", this.#budget.limits.maxInputBytes);
  }

  admitOutputBytes(bytes: number): void {
    this.assertOpen();
    this.#budget.outputBytes = checkedAdd(this.#budget.outputBytes, bytes, "maxOutputBytes", this.#budget.limits.maxOutputBytes);
  }

  admitResult(): void {
    this.assertOpen();
    this.#budget.results = checkedAdd(this.#budget.results, 1, "maxResults", this.#budget.limits.maxResults);
  }

  measure(value: Json): Promise<number> {
    return this.#track(this.#measure(value));
  }

  async #measure(value: Json): Promise<number> {
    this.assertOpen();
    let bytes = 0;
    const ancestors = new Set<object>();
    type Visit = { readonly kind: "value"; readonly value: unknown; readonly depth: number } | { readonly kind: "leave"; readonly value: object };
    const stack: Visit[] = [{ kind: "value", value, depth: 0 }];
    while (stack.length > 0) {
      const item = stack.pop()!;
      if (item.kind === "leave") {
        ancestors.delete(item.value);
        continue;
      }
      await this.charge(1);
      this.assertOpen();
      if (item.depth > this.#budget.limits.maxDepth) throw new JqLimitError("maxDepth");
      const current = item.value;
      if (current === null || typeof current === "boolean") {
        bytes = this.#addMeasured(bytes, scalarBytes(current));
      } else if (typeof current === "number" || current instanceof Decimal) {
        validateNumber(current);
        const text = numberText(current);
        await this.#visitText(text, false);
        this.assertOpen();
        bytes = this.#addMeasured(bytes, Buffer.byteLength(text));
      } else if (typeof current === "string") {
        if (!wellFormed(current)) throw new YqValueFailure("ENCODE_INVALID_UNICODE");
        const escaped = await this.#visitText(current, true);
        this.assertOpen();
        bytes = this.#addMeasured(bytes, escaped + 2);
      } else if (typeof current === "object") {
        const objectValue = current as object;
        if (ancestors.has(objectValue)) throw new YqValueFailure("ENCODE_CYCLIC_GRAPH");
        const prototype = Object.getPrototypeOf(objectValue);
        const array = Array.isArray(current);
        if (!array && prototype !== null && prototype !== Object.prototype) {
          throw new YqValueFailure("ENCODE_UNSUPPORTED_VALUE");
        }
        if (item.depth + 1 > this.#budget.limits.maxDepth) throw new JqLimitError("maxDepth");
        const keys = array ? Object.keys(current) : objectKeys(current as Record<string, Json>);
        this.#budget.collection(keys.length);
        bytes = this.#addMeasured(bytes, 2 + Math.max(0, keys.length - 1));
        ancestors.add(objectValue);
        stack.push({ kind: "leave", value: objectValue });
        for (let index = keys.length - 1; index >= 0; index--) {
          const key = keys[index]!;
          if (!array) {
            if (!wellFormed(key)) throw new YqValueFailure("ENCODE_INVALID_UNICODE");
            const escaped = await this.#visitText(key, true);
            this.assertOpen();
            bytes = this.#addMeasured(bytes, escaped + 3);
          }
          stack.push({ kind: "value", value: (current as Record<string, unknown>)[key], depth: item.depth + 1 });
        }
      } else {
        throw new YqValueFailure("ENCODE_UNSUPPORTED_VALUE");
      }
    }
    this.assertOpen();
    return bytes;
  }

  stringifyJson(value: Json, options: { readonly pretty: boolean; readonly maxBytes: number; readonly limitName: "maxValueBytes" | "maxOutputBytes" }): Promise<string> {
    return this.#track(this.#stringifyJson(value, options));
  }

  async #stringifyJson(value: Json, options: { readonly pretty: boolean; readonly maxBytes: number; readonly limitName: "maxValueBytes" | "maxOutputBytes" }): Promise<string> {
    assertNonnegativeSafe(options.maxBytes, "maxBytes");
    const fragments: string[] = [];
    let bytes = 0;
    const append = async (fragment: string): Promise<void> => {
      const fragmentBytes = Buffer.byteLength(fragment);
      if (fragmentBytes > options.maxBytes - bytes) throw new JqLimitError(options.limitName);
      if (fragmentBytes > 0) await this.charge(Math.ceil(fragmentBytes / 1024));
      this.assertOpen();
      fragments.push(fragment);
      bytes += fragmentBytes;
    };
    const reserveFragment = (projectedBytes: number): void => {
      if (!Number.isSafeInteger(projectedBytes) || projectedBytes < 0 || projectedBytes > options.maxBytes - bytes) {
        throw new JqLimitError(options.limitName);
      }
      bytes += projectedBytes;
    };
    const appendReserved = async (fragment: string, projectedBytes: number): Promise<void> => {
      if (Buffer.byteLength(fragment) !== projectedBytes) throw new Error("escaped fragment projection mismatch");
      if (projectedBytes > 0) await this.charge(Math.ceil(projectedBytes / 1024));
      this.assertOpen();
      fragments.push(fragment);
    };
    const appendIndent = async (depth: number): Promise<void> => {
      const indentBytes = depth * 2;
      if (!Number.isSafeInteger(indentBytes) || indentBytes > options.maxBytes - bytes) throw new JqLimitError(options.limitName);
      await append("  ".repeat(depth));
    };
    const appendString = async (text: string): Promise<void> => {
      if (!wellFormed(text)) throw new YqValueFailure("ENCODE_INVALID_UNICODE");
      await append('"');
      for (let start = 0; start < text.length;) {
        let end = start;
        let codePoints = 0;
        let projectedBytes = 0;
        while (end < text.length && codePoints < 256) {
          const codePoint = text.codePointAt(end)!;
          projectedBytes += jsonEscapedBytes(codePoint);
          end += codePoint > 0xffff ? 2 : 1;
          codePoints++;
        }
        reserveFragment(projectedBytes);
        let fragment = "";
        for (let index = start; index < end;) {
          const codePoint = text.codePointAt(index)!;
          fragment += jsonEscape(codePoint);
          index += codePoint > 0xffff ? 2 : 1;
        }
        await this.charge(codePoints);
        this.assertOpen();
        await appendReserved(fragment, projectedBytes);
        this.assertOpen();
        start = end;
      }
      this.assertOpen();
      await append('"');
    };
    const ancestors = new Set<object>();
    const encode = async (current: unknown, depth: number): Promise<void> => {
      await this.charge(1);
      this.assertOpen();
      if (depth > this.#budget.limits.maxDepth) throw new JqLimitError("maxDepth");
      if (current === null || typeof current === "boolean") {
        await append(JSON.stringify(current));
      } else if (typeof current === "number" || current instanceof Decimal) {
        validateNumber(current);
        await append(numberText(current));
      } else if (typeof current === "string") {
        await appendString(current);
      } else if (typeof current === "object") {
        const objectValue = current as object;
        if (ancestors.has(objectValue)) throw new YqValueFailure("ENCODE_CYCLIC_GRAPH");
        const array = Array.isArray(current);
        const prototype = Object.getPrototypeOf(objectValue);
        if (!array && prototype !== null && prototype !== Object.prototype) throw new YqValueFailure("ENCODE_UNSUPPORTED_VALUE");
        if (depth + 1 > this.#budget.limits.maxDepth) throw new JqLimitError("maxDepth");
        const keys = array ? Object.keys(current) : objectKeys(current as Record<string, Json>);
        this.#budget.collection(keys.length);
        ancestors.add(objectValue);
        try {
          await append(array ? "[" : "{");
          if (options.pretty && keys.length > 0) await append("\n");
          for (let index = 0; index < keys.length; index++) {
            const key = keys[index]!;
            if (index > 0) await append(options.pretty ? ",\n" : ",");
            if (options.pretty) await appendIndent(depth + 1);
            if (!array) {
              if (!wellFormed(key)) throw new YqValueFailure("ENCODE_INVALID_UNICODE");
              await appendString(key);
              await append(options.pretty ? ": " : ":");
            }
            await encode((current as Record<string, unknown>)[key], depth + 1);
          }
          if (options.pretty && keys.length > 0) {
            await append("\n");
            await appendIndent(depth);
          }
          await append(array ? "]" : "}");
        } finally {
          ancestors.delete(objectValue);
        }
      } else {
        throw new YqValueFailure("ENCODE_UNSUPPORTED_VALUE");
      }
    };
    await encode(value, 0);
    this.assertOpen();
    if (bytes > options.maxBytes) throw new JqLimitError(options.limitName);
    return fragments.join("");
  }

  reserve(ordinaryUnits: number): YqPrepaidWork {
    assertNonnegativeSafe(ordinaryUnits, "ordinaryUnits");
    this.assertOpen();
    if (this.#state.activeReservation) throw new Error("nested owned reservation");
    const startPending = this.#state.pending;
    let checkpoints = 0;
    let targetPending = startPending;
    if (ordinaryUnits > 0) {
      if (ordinaryUnits > Number.MAX_SAFE_INTEGER - startPending) throw new RangeError("owned reservation overflow");
      const sum = startPending + ordinaryUnits;
      checkpoints = Math.floor((sum - 1) / checkpointWidth);
      targetPending = sum - checkpoints * checkpointWidth;
    }
    if (checkpoints > Number.MAX_SAFE_INTEGER - ordinaryUnits) throw new RangeError("owned reservation overflow");
    const total = ordinaryUnits + checkpoints;
    this.#budget.step(total);
    this.assertOpen();
    this.#state.activeReservation = true;
    let ordinaryRemaining = ordinaryUnits;
    let checkpointRemaining = checkpoints;
    let executionPending = startPending;
    let active = true;
    let releaseReservation!: () => void;
    const reservationLifetime = new Promise<void>(resolve => { releaseReservation = resolve; });
    this.#active.add(reservationLifetime);
    void reservationLifetime.finally(() => this.#active.delete(reservationLifetime));
    const fail = (): never => {
      active = false;
      this.#state.activeReservation = false;
      this.#state.terminal = true;
      this.#activeAbandon = undefined;
      releaseReservation();
      throw new Error("invalid prepaid owned-work schedule");
    };
    const abandon = (): void => {
      if (!active) return;
      active = false;
      this.#state.activeReservation = false;
      this.#state.terminal = true;
      this.#activeAbandon = undefined;
      releaseReservation();
    };
    this.#activeAbandon = abandon;
    const beforeUnit = async (): Promise<void> => {
        if (!active || ordinaryRemaining === 0) fail();
        this.assertOpen();
        if (executionPending === checkpointWidth) {
          if (checkpointRemaining === 0) fail();
          checkpointRemaining--;
          throwSignal(this.#signal);
          try {
            await yieldTurn(this.#signal);
          } catch (failure) {
            if (this.#signal.aborted) throw this.#signal.reason;
            throw failure;
          }
          this.assertOpen();
          executionPending = 0;
        } else {
          await Promise.resolve();
          this.assertOpen();
        }
        ordinaryRemaining--;
        executionPending++;
    };
    return Object.freeze({
      beforeUnit: (): Promise<void> => this.#track(beforeUnit()),
      finish: (): void => {
        if (!active || ordinaryRemaining !== 0 || checkpointRemaining !== 0 || executionPending !== targetPending) fail();
        this.assertOpen();
        active = false;
        this.#state.pending = targetPending;
        this.#state.activeReservation = false;
        this.#activeAbandon = undefined;
        releaseReservation();
      },
      abandon,
    });
  }

  async close(): Promise<void> {
    this.#state.accepting = false;
    this.#activeAbandon?.();
    await Promise.allSettled([...this.#active]);
  }

  #addMeasured(current: number, incoming: number): number {
    if (incoming > this.#budget.limits.maxValueBytes - current) throw new JqLimitError("maxValueBytes");
    return current + incoming;
  }

  async #visitText(text: string, escaped: boolean): Promise<number> {
    if (!wellFormed(text)) throw new YqValueFailure("ENCODE_INVALID_UNICODE");
    let encodedBytes = 0;
    let payloadBytes = 0;
    let codePoints = 0;
    for (const character of text) {
      const fragment = escaped ? jsonEscape(character.codePointAt(0)!) : character;
      const bytes = Buffer.byteLength(fragment);
      if (bytes > this.#budget.limits.maxValueBytes - encodedBytes) throw new JqLimitError("maxValueBytes");
      encodedBytes += bytes;
      payloadBytes += Buffer.byteLength(character);
      codePoints++;
      if (codePoints === 256) {
        await this.charge(codePoints);
        this.assertOpen();
        codePoints = 0;
      }
    }
    if (codePoints > 0) {
      await this.charge(codePoints);
      this.assertOpen();
    }
    if (payloadBytes > 0) {
      await this.charge(Math.ceil(payloadBytes / 1024));
      this.assertOpen();
    }
    return encodedBytes;
  }

  #track<Result>(promise: Promise<Result>): Promise<Result> {
    this.#active.add(promise);
    void promise.finally(() => this.#active.delete(promise)).catch(() => {});
    return promise;
  }
}

class QuerySession implements YqQuerySession {
  readonly ownedWork: OwnedWork;
  readonly #signal: AbortSignal;
  readonly #variables: ReadonlyMap<string, Json> = new Map();
  readonly #budget: Budget;
  readonly #interpreter: Interpreter;
  #ast: Ast | undefined;
  #compileAttempted = false;
  #accepting = true;
  #active: AsyncGenerator<Json> | undefined;
  #activeReturn: Promise<unknown> | undefined;
  #closePromise: Promise<void> | undefined;

  constructor(signal: AbortSignal) {
    if (!(signal instanceof AbortSignal)) throw new TypeError("signal must be an AbortSignal");
    this.#signal = signal;
    this.#budget = new Budget(yqQueryLimits, signal);
    this.#interpreter = new Interpreter(this.#budget, this.#variables);
    this.ownedWork = new OwnedWork(this.#budget, signal);
  }

  compileOnce(source: string): void {
    this.#assertAdmission();
    if (this.#compileAttempted) throw new Error("yq query compilation was already attempted");
    this.#compileAttempted = true;
    this.#ast = parse(source, this.#variables, this.#budget);
  }

  run(input: Json): AsyncGenerator<Json, void, undefined> {
    const session = this;
    return (async function* (): AsyncGenerator<Json, void, undefined> {
      session.#assertAdmission();
      if (!session.#ast) throw new Error("yq query was not compiled successfully");
      if (session.#active) throw new Error("overlapping yq query runs are not allowed");
      const iterator = session.#interpreter.run(session.#ast, input);
      session.#active = iterator;
      session.#activeReturn = undefined;
      try {
        while (true) {
          let next: IteratorResult<Json>;
          try {
            next = await iterator.next();
          } catch (failure) {
            throwSignal(session.#signal);
            throw failure;
          }
          session.#assertAdmission();
          if (next.done) return;
          yield next.value;
          session.#assertAdmission();
        }
      } finally {
        try {
          await session.#returnActive(iterator);
        } finally {
          if (session.#active === iterator) session.#active = undefined;
        }
      }
    })();
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#accepting = false;
    this.#closePromise = (async (): Promise<void> => {
      const failures: unknown[] = [];
      const active = this.#active;
      if (active) {
        try { await this.#returnActive(active); }
        catch (failure) { failures.push(failure); }
      }
      try { await this.ownedWork.close(); }
      catch (failure) { failures.push(failure); }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "yq query session cleanup failed");
    })();
    void this.#closePromise.catch(() => {});
    return this.#closePromise;
  }

  #assertAdmission(): void {
    throwSignal(this.#signal);
    if (!this.#accepting) throw new Error("yq query session is closed");
  }

  #returnActive(iterator: AsyncGenerator<Json>): Promise<unknown> {
    if (this.#active === iterator && this.#activeReturn) return this.#activeReturn;
    const returned = Promise.resolve().then(() => iterator.return(undefined));
    if (this.#active === iterator) this.#activeReturn = returned;
    void returned.catch(() => {});
    return returned;
  }
}

export function createYqQuerySession(options: { readonly signal: AbortSignal }): YqQuerySession {
  if (typeof options !== "object" || options === null) throw new TypeError("options must be an object");
  return new QuerySession(options.signal);
}
