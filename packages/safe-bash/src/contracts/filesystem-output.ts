import { FsError } from "./errors.js";
import type { FsOptions } from "./filesystem.js";
import { createBytePipe, outputFailure, type BytePipe, type ByteSink, type ByteSource } from "./io.js";
import { createOutputOperation } from "./output.js";

import { filesystemOutputBudgets, type FileOutputContext } from "./filesystem-output-budget.js";
import { openCommandFile, type CommandFileDescriptor } from "./filesystem-descriptor.js";
export { bindFileOutputBudget, assertCountedFileOutput, writeFileOutputCounted } from "./filesystem-output-budget.js";
export type { CountedFileWrite, FileOutputContext } from "./filesystem-output-budget.js";

export interface FileOutput {
  readonly sink: ByteSink;
  readonly signal: AbortSignal;
  readonly descriptor?: CommandFileDescriptor;
  finish(): Promise<void>;
  abort(reason: unknown): Promise<void>;
}

export interface FileOutputOpenOptions {
  readonly flag: "w" | "a" | "wx";
  readonly mode?: number;
  readonly descriptor?: boolean;
}

async function openDescriptorOutput(context: FileOutputContext, path: string, options: FileOutputOpenOptions): Promise<FileOutput> {
  const { flag, mode } = options;
  if (flag !== "w" && flag !== "a" && flag !== "wx") throw new TypeError("Invalid descriptor output flag");
  const controller = new AbortController();
  const signal = AbortSignal.any([context.signal, controller.signal]);
  const cleanups: (() => void | Promise<void>)[] = [];
  let descriptor: CommandFileDescriptor | undefined;
  let accepting = true;
  let completed = false;
  let failure: { reason: unknown } | undefined;
  let retirementFailure: { reason: unknown } | undefined;
  let writes: Promise<void> = Promise.resolve();
  let closing: Promise<void> | undefined;
  let finishing: Promise<void> | undefined;
  let aborting: Promise<void> | undefined;
  let acquired!: () => void;
  const acquisition = new Promise<void>(resolve => { acquired = resolve; });
  const check = (): void => {
    context.signal.throwIfAborted();
    if (failure) throw failure.reason;
    signal.throwIfAborted();
  };
  const retire = (): Promise<void> => {
    accepting = false;
    closing ??= (async () => {
      await acquisition;
      await writes;
      try { await descriptor?.close(); }
      catch (reason) { retirementFailure = { reason }; throw reason; }
      finally { context.signal.removeEventListener("abort", interrupted); }
    })();
    void closing.catch(() => {});
    return closing;
  };
  const interrupted = (): void => { void retire().catch(() => {}); };
  const cleanup = async (): Promise<void> => {
    await retire().catch(() => {});
    let cleanupFailure: { reason: unknown } | undefined;
    for (const close of cleanups) {
      try { await close(); } catch (reason) { cleanupFailure ??= { reason }; }
    }
    context.signal.throwIfAborted();
    if (!failure && cleanupFailure) throw cleanupFailure.reason;
  };
  const registerCleanup = (close: () => void | Promise<void>): void => { cleanups.push(close); };
  const budget = context.registerCleanup && filesystemOutputBudgets.get(context.registerCleanup);
  if (budget) filesystemOutputBudgets.set(registerCleanup, budget);
  try {
    context.registerCleanup?.(cleanup);
    context.signal.addEventListener("abort", interrupted, { once: true });
    check();
    const capabilities = await context.fs.capabilitiesFor?.(path, { signal }) ?? context.fs.capabilities;
    check();
    if (!accepting) throw new FsError("EBADF", { path, syscall: "open" });
    if (capabilities.readOnly === true) throw new FsError("EROFS", { path, syscall: "open" });
    if (flag === "a" ? capabilities.append === false : capabilities.write === false) throw new FsError("ENOTSUP", { path, syscall: "open" });
    if (flag === "wx" && capabilities.exclusiveCreate !== true) throw new FsError("ENOTSUP", { path, syscall: "open" });
    descriptor = await openCommandFile({ fs: context.fs, signal, registerCleanup, cleanupFailurePrioritySignal: context.signal }, path, {
      access: "write", creation: flag === "wx" ? "exclusive" : "ifMissing",
      truncate: flag === "w", append: flag === "a", ...(mode === undefined ? {} : { mode }),
    });
    acquired();
    check();
    if (!accepting) throw new FsError("EBADF", { path, syscall: "open" });
    const retained = descriptor;
    const admit = <Result>(syscall: string, forwarded: FsOptions, action: (options: FsOptions) => Promise<Result>): Promise<Result> => {
      try {
        const operationSignal = forwarded.signal;
        context.signal.throwIfAborted();
        signal.throwIfAborted();
        operationSignal?.throwIfAborted();
        if (!accepting) throw new FsError("EBADF", { path, syscall });
        return action(operationSignal === undefined ? {} : { signal: operationSignal });
      } catch (reason) { return Promise.reject(reason); }
    };
    const exposed: CommandFileDescriptor = {
      capabilities: retained.capabilities,
      ...(retained.getPosition ? { getPosition: (forwarded = {}) => admit("getPosition", forwarded, supplied => retained.getPosition!(supplied)) } : {}),
      stat: (forwarded = {}) => admit("fstat", forwarded, supplied => retained.stat(supplied)),
      read: (buffer, position, forwarded = {}) => admit("read", forwarded, supplied => retained.read(buffer, position, supplied)),
      write: (buffer, position, forwarded = {}) => admit("write", forwarded, supplied => retained.write(buffer, position, supplied)),
      truncate: (length, forwarded = {}) => admit("ftruncate", forwarded, supplied => retained.truncate(length, supplied)),
      sync: (dataOnly, forwarded = {}) => admit(dataOnly ? "fdatasync" : "fsync", forwarded, supplied => retained.sync(dataOnly, supplied)),
      close: retire,
      acknowledgeCloseFailure: retained.acknowledgeCloseFailure,
    };
    const write = (chunk: Uint8Array): Promise<void> => {
      try {
        check();
        if (!accepting) throw new FsError("EBADF", { path, syscall: "write" });
        if (!(chunk instanceof Uint8Array)) throw new TypeError("Byte sinks require Uint8Array chunks");
      } catch (reason) { return Promise.reject(reason); }
      const writing = writes.then(async () => {
        try {
          check();
          for (let offset = 0; offset < chunk.byteLength;) {
            const end = Math.min(offset + 64 * 1024, chunk.byteLength);
            const count = await descriptor!.write(chunk.subarray(offset, end), null);
            check();
            if (!count) throw new FsError("EIO", { path, syscall: "write", message: "descriptor write made no progress" });
            offset += count;
          }
        } catch (reason) {
          failure ??= { reason: context.signal.aborted ? context.signal.reason : reason };
          controller.abort(failure.reason);
          check();
        }
      });
      writes = writing.then(() => {}, () => {});
      return writing;
    };
    const abort = (reason: unknown): Promise<void> => {
      if (!completed && !retirementFailure) {
        failure ??= { reason };
        controller.abort(failure.reason);
      }
      return aborting ??= cleanup();
    };
    return {
      descriptor: exposed, signal,
      sink: { write, [outputFailure]: abort, ownedOutput: { consumerClosed: controller.signal, write } },
      finish() {
        const retired = retire();
        finishing ??= (async () => {
          let closeFailure: { reason: unknown } | undefined;
          try { await retired; } catch (reason) { closeFailure = { reason }; }
          check();
          if (closeFailure) throw closeFailure.reason;
          completed = true;
        })();
        return finishing;
      },
      abort,
    };
  } catch (reason) {
    failure ??= { reason };
    acquired();
    await cleanup().catch(() => {});
    context.signal.throwIfAborted();
    throw failure.reason;
  }
}

export async function openFileOutput(context: FileOutputContext, path: string, options: "w" | "a" | FileOutputOpenOptions, incremental?: () => Promise<ByteSink>): Promise<FileOutput> {
  if (typeof options !== "string") {
    if (options.descriptor !== undefined && typeof options.descriptor !== "boolean") throw new TypeError("Invalid descriptor output option");
    if (options.descriptor === true) return openDescriptorOutput(context, path, options);
  }
  const { flag, mode } = typeof options === "string" ? { flag: options, mode: undefined } : options;
  let pipe: BytePipe | undefined;
  let task: Promise<void> | undefined;
  let completed = false;
  let ended = false;
  let closing = false;
  let failure: { reason: unknown } | undefined;
  const consumer = new AbortController();
  let writes = Promise.resolve();
  let acknowledge: (() => void) | undefined;
  let ready!: () => void;
  const opened = new Promise<void>(resolve => { ready = resolve; });
  const destination: ByteSink = {
    [outputFailure]: reason => operation.abort(reason),
    async write(chunk) {
      if (closing) throw new FsError("EBADF", { path, syscall: "write" });
      const writing = writes.then(async () => {
        for (let offset = 0; offset < chunk.byteLength; offset += 64 * 1024) {
          const accepted = new Promise<void>(resolve => { acknowledge = resolve; });
          await pipe!.writable.write(chunk.subarray(offset, offset + 64 * 1024));
          await Promise.race([accepted, task!]);
        }
      });
      writes = writing.catch(() => {});
      await writing;
    },
  };
  const budget = context.registerCleanup && filesystemOutputBudgets.get(context.registerCleanup);
  const operation = createOutputOperation(context, budget?.sinkBudget(destination) ?? destination);
  operation.registerCleanup(async () => {
    closing = true;
    if (!completed) {
      void operation.abort(operation.signal.aborted ? operation.signal.reason : new FsError("ECANCELED", { path, syscall: "write" }));
      await pipe?.abort(operation.signal.reason);
    }
    await task?.catch(() => {});
    await writes;
  });
  try {
    pipe = createBytePipe({ highWaterMark: 1, signal: operation.signal });
    let reading = false;
    const source: ByteSource = {
      [Symbol.asyncIterator]() {
        return (async function* () {
          reading = true;
          ready();
          for await (const chunk of pipe!.readable) {
            yield chunk;
            acknowledge?.();
            acknowledge = undefined;
          }
          operation.signal.throwIfAborted();
          ended = true;
        })();
      },
    };
    task = (async () => {
      const { fs } = context;
      const signal = operation.signal;
      signal.throwIfAborted();
      const capabilities = await fs.capabilitiesFor?.(path, { signal }) ?? fs.capabilities;
      if (capabilities.readOnly === true) throw new FsError("EROFS", { path, syscall: "write" });
      if (incremental && (flag === "wx" || mode !== undefined)) throw new FsError("ENOTSUP", { path, syscall: "write", message: "incremental callback cannot honor exclusive creation or initial mode" });
      if (flag === "wx") {
        if (capabilities.exclusiveCreate !== true) throw new FsError("ENOTSUP", { path, syscall: "write", message: "exclusive creation is not supported" });
      } else {
        try { await fs.access(path, 2, { signal }); }
        catch (error) {
          signal.throwIfAborted();
          if (!(error instanceof FsError) || error.code !== "ENOENT" && error.code !== "ENOTSUP") throw error;
        }
      }
      signal.throwIfAborted();
      const fsOptions = { signal, ...(mode === undefined ? {} : { mode }) };
      const streaming = flag === "a" ? capabilities.streamingAppend ?? capabilities.streamingWrite : capabilities.streamingWrite;
      if (!incremental && streaming !== false && fs.writeStream) {
        try {
          await fs.writeStream(path, source, { ...fsOptions, flag });
          if (!ended) throw new FsError("EIO", { path, message: "Streaming writer returned before consuming output" });
          return;
        } catch (error) {
          signal.throwIfAborted();
          if (flag === "wx" || reading || !(error instanceof FsError) || error.code !== "ENOTSUP") throw error;
        }
      }
      if (flag === "wx") throw new FsError("ENOTSUP", { path, syscall: "writeStream", message: "exclusive output requires streaming support" });
      if (flag === "w" && capabilities.write === false) throw new FsError("ENOTSUP", { path, syscall: "writeFile" });
      if ((!incremental || flag === "a") && capabilities.append === false) throw new FsError("ENOTSUP", { path, syscall: "appendFile" });
      const sink = incremental ? await incremental() : await (async (): Promise<ByteSink> => {
        if (flag === "a") await fs.appendFile(path, new Uint8Array(), fsOptions);
        else await fs.writeFile(path, new Uint8Array(), { ...fsOptions, flag });
        return { write: chunk => fs.appendFile(path, chunk, fsOptions) };
      })();
      for await (const chunk of source) {
        signal.throwIfAborted();
        await sink.write(chunk);
      }
    })();
    void task.catch(error => {
      failure = { reason: error };
      if (!operation.signal.aborted) consumer.abort(error);
      void operation.abort(error).catch(() => {});
    });
    await Promise.race([opened, task]);
    operation.signal.throwIfAborted();
    const write = async (chunk: Uint8Array): Promise<void> => {
      try { await operation.output.write(chunk); }
      catch (error) { throw failure ? failure.reason : error; }
    };
    return {
      signal: operation.signal,
      sink: {
        [outputFailure]: destination[outputFailure]!,
        ownedOutput: { consumerClosed: consumer.signal, write },
        write,
      },
      async finish() {
        closing = true;
        try {
          await writes;
          await pipe!.close();
          await task;
          operation.signal.throwIfAborted();
          completed = true;
        } catch (error) { throw failure ? failure.reason : error; }
        finally { await operation.close(); }
      },
      abort: reason => operation.abort(reason),
    };
  } catch (error) {
    await operation.abort(error);
    throw error;
  }
}
