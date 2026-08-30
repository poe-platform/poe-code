import type { CommandContext } from "../../contracts/command.js";
import type { FileStat } from "../../contracts/filesystem.js";
import { FsError } from "../../contracts/errors.js";
import type { ByteSource } from "../../contracts/io.js";
import { createOutputOperation, type OutputOperation } from "../../contracts/output.js";
import { resolvePath } from "../../contracts/path.js";
import { compareObservedEntries } from "../copy-identity.js";
import type { Arguments } from "./argv.js";
import { inferDelimiter } from "./argv.js";
import { Budget } from "./budget.js";
import { Scanner } from "./csv.js";

export class EscapingFailure { constructor(readonly reason: unknown) {} }
export async function observe<Value>(start: () => Value | PromiseLike<Value>, signal: AbortSignal): Promise<Value> {
  signal.throwIfAborted();
  return new Promise<Value>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    try {
      Promise.resolve(start()).then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
    } catch (error) { signal.removeEventListener("abort", abort); reject(error); }
  });
}
export class InputScope {
  private readonly scanners = new Set<Scanner>();
  private readonly resources: (() => void | Promise<void>)[] = [];
  private readonly controller = new AbortController();
  private readonly signal: AbortSignal;
  private closed = false;
  private closing?: Promise<void>;
  readonly close = (): Promise<void> => {
    if (this.closing) return this.closing;
    this.closed = true;
    this.controller.abort(new Error("xan input scope closed"));
    this.closing = Promise.resolve().then(async () => {
      const outcomes = await Promise.allSettled([...this.scanners].map(scanner => scanner.close()).concat(this.resources.map(async close => close())));
      const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected").map(outcome => outcome.reason);
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "xan input cleanup failed");
    });
    return this.closing;
  };
  constructor(readonly context: CommandContext, readonly budget: Budget) {
    this.signal = AbortSignal.any([budget.signal, this.controller.signal]);
    context.registerCleanup?.(this.close);
  }
  own(close: () => void | Promise<void>): void {
    if (this.closed) throw new Error("xan input admission closed");
    this.resources.push(close);
  }
  private manage(source: ByteSource): ByteSource {
    let iterator: AsyncIterator<Uint8Array> | undefined;
    let finished = false;
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      closing ??= Promise.resolve().then(async () => {
        const resource = finished ? undefined : iterator;
        finished = true;
        await resource?.return?.();
      });
      return closing;
    };
    this.own(close);
    return { [Symbol.asyncIterator]: () => ({
      next: async () => {
        this.signal.throwIfAborted();
        if (this.closed || finished) return { done: true, value: undefined };
        iterator ??= source[Symbol.asyncIterator]();
        const next = await iterator.next();
        if (next.done) finished = true;
        this.signal.throwIfAborted();
        if (this.closed) return { done: true, value: undefined };
        return next;
      },
      return: async () => { await close(); return { done: true, value: undefined }; },
    }) };
  }
  open(path: string, args: Arguments): Scanner {
    this.budget.check();
    if (this.closed) throw new Error("xan input admission closed");
    let source: ByteSource;
    if (path === "-") {
      const borrowed = this.context.stdin;
      source = { [Symbol.asyncIterator]() {
        const iterator = borrowed[Symbol.asyncIterator]();
        return { next: () => iterator.next() };
      } };
    } else {
      if (!this.context.fs.readStream) throw new FsError("ENOTSUP", { path, message: "xan requires streaming input" });
      source = this.manage(this.context.fs.readStream(resolvePath(this.context.cwd, path), { signal: this.signal }));
    }
    this.budget.hold(32);
    const scanner = new Scanner(source, args.delimiter ?? inferDelimiter(path), args.command, this.budget, this.signal);
    this.scanners.add(scanner);
    this.own(() => { this.budget.release(32); });
    return scanner;
  }
}
export interface Destination { readonly path: string; readonly flag: "w" | "wx" }
export async function preflight(context: CommandContext, args: Arguments, budget: Budget): Promise<Destination | undefined> {
  if (!args.output) return undefined;
  const fs = context.fs;
  const options = { signal: budget.signal };
  const inputs: { path: string; stat: FileStat }[] = [];
  for (const input of args.inputs) {
    if (input === "-") continue;
    const path = resolvePath(context.cwd, input);
    if (path === args.output) throw new FsError("EINVAL", { path, message: "input and output are the same file" });
    await observe(() => fs.lstat(path, options), budget.signal);
    const stat = await observe(() => fs.stat(path, options), budget.signal);
    if (stat.type !== "file") throw new FsError("EINVAL", { path, message: "input must be a regular file" });
    inputs.push({ path, stat });
  }
  let entry: FileStat;
  try { entry = await observe(() => fs.lstat(args.output!, options), budget.signal); }
  catch (error) {
    budget.check();
    if (error instanceof FsError && error.code === "ENOENT") return { path: args.output, flag: "wx" };
    throw error;
  }
  let destination: FileStat;
  try { destination = await observe(() => fs.stat(args.output!, options), budget.signal); }
  catch (error) {
    budget.check();
    if (entry.type === "symlink" && error instanceof FsError && error.code === "ENOENT") throw new FsError("ENOTSUP", { path: args.output, message: "dangling output symlink is unsupported" });
    throw error;
  }
  if (destination.type !== "file") throw new FsError("EINVAL", { path: args.output, message: "output must be a regular file" });
  if (args.inputs.includes("-")) throw new FsError("ENOTSUP", { path: args.output, message: "cannot prove borrowed stdin distinct from existing output" });
  for (const input of inputs) {
    const relation = await observe(() => compareObservedEntries(fs, input.path, input.stat, fs, args.output!, destination, options), budget.signal);
    if (relation !== "distinct") throw new FsError(relation === "same" ? "EINVAL" : "ENOTSUP", { path: args.output, message: relation === "same" ? "input and output are the same file" : "input/output identity is unknown" });
  }
  return { path: args.output, flag: "w" };
}
export function outputOperation(context: CommandContext, file: boolean): OutputOperation {
  return createOutputOperation(context, file ? { async write() { throw new Error("file operation has no stdout sink"); } } : context.stdout);
}
export function managedOutput(source: ByteSource, scope: InputScope, budget: Budget): ByteSource {
  let iterator: AsyncIterator<Uint8Array> | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closed = true;
    closing ??= Promise.resolve().then(async () => { await iterator?.return?.(); });
    return closing;
  };
  scope.own(close);
  return { [Symbol.asyncIterator]: () => ({
    next: async () => {
      budget.check();
      if (closed) return { done: true, value: undefined };
      iterator ??= source[Symbol.asyncIterator]();
      const next = await iterator.next();
      if (!next.done) for (let offset = 0; offset < next.value.length; offset += 4096) {
        budget.work(Math.min(4096, next.value.length - offset)); await budget.checkpoint();
      }
      return next;
    },
    return: async () => { await close(); return { done: true, value: undefined }; },
  }) };
}
export async function publish(context: CommandContext, destination: Destination | undefined, source: ByteSource, operation: OutputOperation, budget: Budget): Promise<void> {
  if (!destination) {
    for await (const chunk of source) {
      try { await operation.output.write(chunk); }
      catch (error) { throw new EscapingFailure(error); }
      budget.check();
    }
    return;
  }
  const options = { signal: operation.signal, flag: destination.flag };
  if (context.fs.writeStream) {
    await observe(() => context.fs.writeStream!(destination.path, source, options), operation.signal);
    budget.check(); return;
  }
  const parts: Uint8Array[] = [];
  let size = 0;
  let result: Uint8Array | undefined;
  try {
    for await (const chunk of source) {
      budget.hold(chunk.length + 32);
      let admitted = false;
      try {
        const copy = new Uint8Array(chunk.length);
        for (let offset = 0; offset < chunk.length; offset += 4096) {
          const fragment = chunk.subarray(offset, offset + 4096);
          budget.work(fragment.length); copy.set(fragment, offset); await budget.checkpoint();
        }
        parts.push(copy); size += chunk.length; admitted = true;
      } finally { if (!admitted) budget.release(chunk.length + 32); }
    }
    budget.hold(size); result = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      for (let begin = 0; begin < part.length; begin += 4096) {
        const fragment = part.subarray(begin, begin + 4096);
        budget.work(fragment.length); result.set(fragment, offset); offset += fragment.length; await budget.checkpoint();
      }
    }
    await observe(() => context.fs.writeFile(destination.path, result!, options), operation.signal);
    budget.check();
  } finally {
    for (const part of parts) budget.release(part.length + 32);
    if (result) budget.release(result.length);
  }
}
