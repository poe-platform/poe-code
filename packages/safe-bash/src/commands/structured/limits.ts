import { yieldTurn } from "../../contracts/yield.js";
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
  maxInputBytes: 64 * 1024 * 1024, maxValueBytes: 8 * 1024 * 1024,
  maxOutputBytes: 16 * 1024 * 1024, maxSourceBytes: 64 * 1024,
  maxDepth: 128, maxAstDepth: 64, maxSteps: 1_000_000,
  maxResults: 100_000, maxCollectionSize: 100_000,
});
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
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
  }
  if (limits.maxDepth > 256 || limits.maxAstDepth > 128) throw new RangeError("maxDepth must be <=256 and maxAstDepth <=128");
  return Object.freeze(limits);
}
export class Budget {
  private steps = 0;
  private nextYield = 1024;
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
  async tick(): Promise<void> {
    this.step();
    if (this.steps >= this.nextYield) {
      this.nextYield = this.steps + 1024;
      await yieldTurn(this.signal);
      this.signal.throwIfAborted();
    }
  }
  collection(size: number): void {
    if (size > this.limits.maxCollectionSize) throw new JqLimitError("maxCollectionSize");
  }
  text(text: string): void {
    if (text.length > this.limits.maxValueBytes || Buffer.byteLength(text) > this.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
  }
  value(value: Json): number {
    let bytes = 0;
    const visit = (current: Json, depth: number): void => {
      this.step();
      if (depth > this.limits.maxDepth) throw new JqLimitError("maxDepth");
      if (current !== null && typeof current === "object" && !(current instanceof Decimal)) {
        if (depth + 1 > this.limits.maxDepth) throw new JqLimitError("maxDepth");
        const keys = Array.isArray(current) ? Object.keys(current) : objectKeys(current);
        this.collection(keys.length);
        bytes += 2 + Math.max(0, keys.length - 1);
        for (const key of keys) {
          if (!Array.isArray(current)) {
            this.text(key);
            bytes += Buffer.byteLength(JSON.stringify(key)) + 1;
          }
          if (bytes > this.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
          visit((current as Record<string, Json>)[key]!, depth + 1);
        }
      } else {
        if (typeof current === "string") this.text(current);
        bytes += Buffer.byteLength(scalarJson(current, this));
      }
      if (bytes > this.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
    };
    visit(value, 0);
    return bytes;
  }
}
const keyOrders = new WeakMap<Record<string, Json>, string[]>();
export function object(): Record<string, Json> {
  const result = Object.create(null) as Record<string, Json>;
  keyOrders.set(result, []);
  return result;
}
export function objectKeys(value: Record<string, Json>): string[] { return keyOrders.get(value)?.slice() ?? Object.keys(value); }
export function objectSize(value: Record<string, Json>): number { return keyOrders.get(value)?.length ?? Object.keys(value).length; }
export function put(value: Record<string, Json>, key: string, item: Json): void {
  if (!Object.hasOwn(value, key)) keyOrders.get(value)?.push(key);
  value[key] = item;
}
export function remove(value: Record<string, Json>, key: string): void {
  delete value[key];
  const keys = keyOrders.get(value);
  if (keys) { const index = keys.indexOf(key); if (index >= 0) keys.splice(index, 1); }
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
