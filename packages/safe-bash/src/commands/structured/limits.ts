import { monotonicNow, yieldTurn } from "../../contracts/yield.js";
import { Decimal, isNumber, numberText } from "./numbers.js";

export type Json = null | boolean | number | Decimal | string | Json[] | { [key: string]: Json };
export interface JqLimits {
  readonly maxInputBytes: number;
  readonly maxValueBytes: number;
  readonly maxOutputBytes: number;
  readonly maxSourceBytes: number;
  readonly maxDepth: number;
  readonly maxAstDepth: number;
  readonly maxSteps: number;
  readonly maxResults: number;
  readonly maxCollectionSize: number;
}
export interface StructuredCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<JqLimits>;
}
export const defaultJqLimits: Readonly<JqLimits> = Object.freeze({
  maxInputBytes: Infinity, maxValueBytes: Infinity,
  maxOutputBytes: Infinity, maxSourceBytes: Infinity,
  maxDepth: Infinity, maxAstDepth: Infinity, maxSteps: Infinity,
  maxResults: Infinity, maxCollectionSize: Infinity,
});
export class JqHalt extends Error {
  constructor(readonly exitCode: number, readonly stderr: string) { super("jq halted"); }
}
export class JqError extends Error {
  constructor(message: string, readonly exitCode = 5) { super(message); }
}
export class JqLimitError extends JqError {
  constructor(name: keyof JqLimits) { super(`${name} limit exceeded`); }
}
export interface InputLocation {
  name: string;
  line: number;
  complete: boolean;
}
export function resolveJqLimits(options: Partial<JqLimits> = {}): JqLimits {
  const limits = { ...defaultJqLimits, ...options };
  for (const [name, value] of Object.entries(limits)) {
    if ((value !== Infinity && !Number.isSafeInteger(value)) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
  }
  return Object.freeze(limits);
}
export class Budget {
  private steps = 0;
  private nextYield = 1024;
  private lastYield = monotonicNow();
  inputBytes = 0;
  outputBytes = 0;
  results = 0;
  inputLocation: InputLocation = { name: "<unknown>", line: 0, complete: true };
  constructor(readonly limits: JqLimits, readonly signal: AbortSignal) {}
  step(count = 1): void {
    this.signal.throwIfAborted();
    this.steps += count;
    if (this.steps > this.limits.maxSteps) throw new JqLimitError("maxSteps");
  }
  get currentSteps(): number { return this.steps; }
  restoreSteps(steps: number): void { this.steps = steps; }
  needsYield(): boolean {
    return this.steps >= this.nextYield || ((this.steps & 31) === 0 && monotonicNow() - this.lastYield >= 25);
  }
  tickSync(count = 1): Promise<void> | undefined {
    this.step(count);
    if (this.steps >= this.nextYield || ((this.steps & 31) === 0 && monotonicNow() - this.lastYield >= 25)) {
      return yieldTurn(this.signal).then(() => {
        this.signal.throwIfAborted();
        this.nextYield = this.steps + 1024;
        this.lastYield = monotonicNow();
      });
    }
    return undefined;
  }
  async tick(count = 1): Promise<void> {
    this.step(count);
    if (this.steps >= this.nextYield || monotonicNow() - this.lastYield >= 25) {
      await yieldTurn(this.signal);
      this.signal.throwIfAborted();
      this.nextYield = this.steps + 1024;
      this.lastYield = monotonicNow();
    }
  }
  collection(size: number): void {
    if (size > this.limits.maxCollectionSize) throw new JqLimitError("maxCollectionSize");
  }
  text(text: string): void {
    if (text.length > this.limits.maxValueBytes || (text.length * 3 > this.limits.maxValueBytes && Buffer.byteLength(text) > this.limits.maxValueBytes)) throw new JqLimitError("maxValueBytes");
  }
  value(value: Json): number {
    return this.visitValue(value, 0, 0);
  }
  private visitValue(current: Json, depth: number, bytes: number): number {
    this.step();
    if (depth > this.limits.maxDepth) throw new JqLimitError("maxDepth");
    if (current !== null && typeof current === "object" && !(current instanceof Decimal)) {
      if (depth + 1 > this.limits.maxDepth) throw new JqLimitError("maxDepth");
      if (Array.isArray(current)) {
        this.collection(current.length);
        bytes += 2 + Math.max(0, current.length - 1);
        for (let index = 0; index < current.length; index++) {
          if (bytes > this.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
          bytes = this.visitValue(current[index]!, depth + 1, bytes);
        }
      } else {
        const keys = keyOrders.get(current);
        if (keys !== undefined) {
          this.collection(keys.length);
          bytes += 2 + Math.max(0, keys.length - 1);
          for (let index = 0; index < keys.length; index++) {
            const key = keys[index]!;
            this.text(key);
            bytes += scalarJsonByteLength(key, this) + 1;
            if (bytes > this.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
            bytes = this.visitValue(current[key]!, depth + 1, bytes);
          }
        } else {
          let count = 0;
          for (const key in current) {
            if (!Object.hasOwn(current, key)) continue;
            this.collection(++count);
            this.text(key);
            bytes += scalarJsonByteLength(key, this) + 1 + (count > 1 ? 1 : 0);
            if (bytes > this.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
            bytes = this.visitValue(current[key]!, depth + 1, bytes);
          }
          bytes += 2;
        }
      }
    } else {
      if (typeof current === "string") { this.step(current.length); this.text(current); }
      bytes += scalarJsonByteLength(current, this);
    }
    if (bytes > this.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
    return bytes;
  }
}
const keyOrders = new WeakMap<Record<string, Json>, string[]>();
export function hasCustomKeyOrder(value: Record<string, Json>): boolean {
  return keyOrders.has(value);
}
export function object(): Record<string, Json> {
  return {} as Record<string, Json>;
}
export function objectKeys(value: Record<string, Json>): string[] { return keyOrders.get(value)?.slice() ?? Object.keys(value); }
export function* objectKeyIterator(value: Record<string, Json>): IterableIterator<string> {
  const keys = keyOrders.get(value);
  if (keys) yield* keys;
  else for (const key in value) if (Object.hasOwn(value, key)) yield key;
}
export function objectSize(value: Record<string, Json>): number { return keyOrders.get(value)?.length ?? Object.keys(value).length; }
export function put(value: Record<string, Json>, key: string, item: Json): void {
  const existing = Object.hasOwn(value, key);
  let keys = keyOrders.get(value);
  if (keys !== undefined) {
    if (!existing) keys.push(key);
  } else if (!existing && key.length > 0) {
    const first = key.charCodeAt(0);
    if (first >= 48 && first <= 57) {
      keys = Object.keys(value);
      keys.push(key);
      keyOrders.set(value, keys);
    }
  }
  if (key === "__proto__") {
    Object.defineProperty(value, "__proto__", { value: item, writable: true, enumerable: true, configurable: true });
  } else {
    value[key] = item;
  }
}
export function remove(value: Record<string, Json>, key: string): void {
  if (!Object.hasOwn(value, key)) return;
  let keys = keyOrders.get(value);
  if (!keys) {
    keys = Object.keys(value);
    keyOrders.set(value, keys);
  }
  delete value[key];
  const index = keys.indexOf(key);
  if (index >= 0) keys.splice(index, 1);
}
export function copyObject(...sources: (Record<string, Json> | null)[]): Record<string, Json> {
  const result = object();
  for (const source of sources) if (source) for (const key of objectKeys(source)) put(result, key, source[key]!);
  return result;
}
export function wellFormed(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
export function isObject(value: Json): value is Record<string, Json> { return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Decimal); }
export function truth(value: Json): boolean { return value !== null && value !== false; }
export function scalarJson(value: null | boolean | number | Decimal | string, budget: Budget): string {
  if (value instanceof Decimal) budget.step(Math.ceil(value.text.length / 32));
  return isNumber(value) ? numberText(value) : JSON.stringify(value);
}
function scalarJsonByteLength(value: null | boolean | number | Decimal | string, budget: Budget): number {
  if (value === null || value === true) return 4;
  if (value === false) return 5;
  if (typeof value === "number") {
    return Number.isFinite(value) ? (Object.is(value, -0) ? 2 : String(value).length) : Buffer.byteLength(scalarJson(value, budget));
  }
  if (value instanceof Decimal) {
    budget.step(Math.ceil(value.text.length / 32));
    return Buffer.byteLength(numberText(value));
  }
  let extra = 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0x80) return Buffer.byteLength(JSON.stringify(value));
    if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) extra++;
    else if (code < 32) extra += 5;
  }
  return value.length + extra;
}
export async function interruptible<Result>(operation: () => PromiseLike<Result>, signal: AbortSignal): Promise<Result> {
  signal.throwIfAborted();
  return new Promise<Result>((resolve, reject) => {
    const aborted = (): void => { signal.removeEventListener("abort", aborted); reject(signal.reason); };
    signal.addEventListener("abort", aborted, { once: true });
    try {
      Promise.resolve(operation()).then(
        result => { signal.removeEventListener("abort", aborted); resolve(result); },
        error => { signal.removeEventListener("abort", aborted); reject(error); },
      );
    } catch (error) { signal.removeEventListener("abort", aborted); reject(error); }
  });
}
