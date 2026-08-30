import assert from "node:assert/strict";
import { createMemoryFileSystem, type ByteSink, type CommandContext, type CommandInvoker, type InvocationCleanup } from "../../../src/index.js";
import type { TimeoutScheduler } from "../../../src/commands/timeout/index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class ManualScheduler implements TimeoutScheduler {
  nowValue = 0;
  nowCalls = 0;
  setCalls: number[] = [];
  clearCalls: unknown[] = [];
  handle: unknown = 0;
  clearFailure: unknown;
  readonly receivers: unknown[] = [];
  #pending: { readonly callback: () => void; readonly handle: unknown; fired: boolean } | undefined;

  now(): number {
    this.receivers.push(this);
    this.nowCalls++;
    return this.nowValue;
  }

  setTimeout(callback: () => void, milliseconds: number): unknown {
    this.receivers.push(this);
    assert.equal(this.#pending, undefined);
    this.setCalls.push(milliseconds);
    const handle = this.handle;
    this.#pending = { callback, handle, fired: false };
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.receivers.push(this);
    this.clearCalls.push(handle);
    assert.ok(this.#pending);
    assert.equal(handle, this.#pending.handle);
    this.#pending = undefined;
    if (this.clearFailure !== undefined) throw this.clearFailure;
  }

  fire(elapsed: number): void {
    assert.ok(this.#pending);
    assert.equal(this.#pending.fired, false);
    this.#pending.fired = true;
    this.nowValue += elapsed;
    this.#pending.callback();
  }

  get pending(): boolean {
    return this.#pending !== undefined;
  }
}

export interface RunCapture {
  readonly context: CommandContext;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly cleanups: InvocationCleanup[];
}

export function captureContext(args: readonly string[], additions: Partial<CommandContext> = {}): RunCapture {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const cleanups: InvocationCleanup[] = [];
  const sink = (chunks: Uint8Array[]): ByteSink => ({ async write(chunk) { chunks.push(Uint8Array.from(chunk)); } });
  const signal = additions.signal ?? new AbortController().signal;
  const context: CommandContext = {
    command: "timeout",
    args,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdinIsDefault: true,
    stdout: sink(stdout),
    stderr: sink(stderr),
    cwd: "/",
    env: {},
    fs: createMemoryFileSystem(),
    signal,
    registerCleanup(cleanup) { cleanups.push(cleanup); },
    ...additions,
  };
  const text = (chunks: Uint8Array[]): string => decoder.decode(Buffer.concat(chunks));
  return { context, stdout: () => text(stdout), stderr: () => text(stderr), cleanups };
}

export function immediateInvoker(result = 0, observe?: Parameters<CommandInvoker>[2] extends infer Value ? (value: Value) => void : never): CommandInvoker {
  return async function (_command, _args, options) {
    observe?.(options);
    return { exitCode: result };
  };
}

export function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

export function gate(): { readonly promise: Promise<void>; readonly release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

export async function turn(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

