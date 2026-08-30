import { types } from "node:util";
import { NodeProfileError, NodeUsageError, nodeLimits, type NodeGrants } from "./types.js";

function inherited(value: object): void {
  let prototype: unknown = Object.getPrototypeOf(value);
  let depth = 0;
  while (prototype !== null) {
    if (typeof prototype !== "object" || types.isProxy(prototype) || ++depth > 16) throw new TypeError("node protocol: prototype chain");
    const names = Reflect.ownKeys(prototype);
    if (names.length > 256) throw new TypeError("node protocol: prototype keys");
    for (const name of names) if (Object.getOwnPropertyDescriptor(prototype, name)?.enumerable) throw new TypeError("node protocol: inherited enumerable field");
    prototype = Object.getPrototypeOf(prototype);
  }
}
export function record(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) throw new TypeError("node protocol: own record");
  inherited(value);
  const names = Reflect.ownKeys(value);
  if (names.length > keys.length + optional.length || keys.some(key => !Object.hasOwn(value, key))) throw new TypeError("node protocol: record keys");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const name of names) {
    if (typeof name !== "string" || !keys.includes(name) && !optional.includes(name)) throw new TypeError("node protocol: extra field");
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new TypeError("node protocol: accessor");
    result[name] = descriptor.value;
  }
  return result;
}
export function text(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string") throw new TypeError("node protocol: " + label);
  if (value.length > maximum || Buffer.byteLength(value) > maximum) throw new NodeProfileError(label);
  return value;
}
export function integer(value: unknown, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0) || value < 0 || value > maximum) throw new TypeError("node protocol: " + label);
  return value;
}
export function strings(value: unknown, maximum: number, bytes: number): string[] {
  if (!Array.isArray(value) || types.isProxy(value)) throw new TypeError("node protocol: array");
  inherited(value);
  const length = Object.getOwnPropertyDescriptor(value, "length");
  const count = integer(length?.value, maximum, "array length");
  if (Reflect.ownKeys(value).length !== count + 1) throw new TypeError("node protocol: array extras");
  const result: string[] = [];
  let remaining = bytes;
  for (let index = 0; index < count; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new TypeError("node protocol: array hole/accessor");
    const entry = text(descriptor.value, remaining, "array bytes");
    remaining -= Buffer.byteLength(entry);
    result.push(entry);
  }
  return result;
}
const grantKeys = ["sourceRead", "dataRead", "dataWrite", "jsonModules", "stdinRead", "stdoutWrite", "stderrWrite"] as const;
export function grants(value: unknown): Required<NodeGrants> {
  const input = record(value, [], grantKeys);
  const result: { -readonly [Key in keyof Required<NodeGrants>]: boolean } = { sourceRead: false, dataRead: false, dataWrite: false, jsonModules: false, stdinRead: false, stdoutWrite: false, stderrWrite: false };
  for (const name of grantKeys) if (Object.hasOwn(input, name)) { if (typeof input[name] !== "boolean") throw new TypeError("node grant must be boolean"); result[name] = input[name] as boolean; }
  return Object.freeze(result);
}
export function environment(value: unknown): Readonly<Record<string, string>> {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) throw new TypeError("node environment");
  inherited(value);
  const keys = Reflect.ownKeys(value);
  if (keys.length > 128) throw new NodeProfileError("environment entries");
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  let remaining = nodeLimits.contextBytes;
  for (const key of keys) {
    if (typeof key !== "string") throw new TypeError("node environment key");
    const name = text(key, remaining, "environment key");
    if (name.includes("\0") || name.includes("=")) throw new NodeUsageError("invalid environment key");
    remaining -= Buffer.byteLength(name);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new TypeError("node environment accessor");
    const entry = text(descriptor.value, remaining, "environment bytes");
    if (entry.includes("\0")) throw new NodeUsageError("invalid environment value");
    remaining -= Buffer.byteLength(entry);
    result[name] = entry;
  }
  return Object.freeze(result);
}
export class NodeLedger {
  #used = 0;
  #peak = 0;
  #labels = new Set<string>();
  reserve(label: string, bytes: number): () => void {
    text(label, 128, "reservation name"); integer(bytes, nodeLimits.memoryBytes, "reservation bytes");
    if (this.#labels.size >= 512 || this.#labels.has(label) || bytes > nodeLimits.memoryBytes - this.#used) throw new NodeProfileError("command-owned memory");
    this.#labels.add(label); this.#used += bytes; this.#peak = Math.max(this.#peak, this.#used);
    let active = true;
    return () => { if (active) { active = false; this.#labels.delete(label); this.#used -= bytes; } };
  }
  get peak(): number { return this.#peak; }
}
