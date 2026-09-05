import type { CommandContext } from "./command.js";
import { FsError } from "./errors.js";
import { createBytePipe, outputFailure, type BytePipe, type ByteSink, type ByteSource } from "./io.js";
import { createOutputOperation } from "./output.js";

export type CountedFileWrite = (chunk: Uint8Array, write: () => Promise<number>) => Promise<number>;

const filesystemOutputBudgets = new WeakMap<NonNullable<CommandContext["registerCleanup"]>, {
  readonly sinkBudget: (sink: ByteSink) => ByteSink;
  readonly countedWrite?: CountedFileWrite;
}>();

export type FileOutputContext = Pick<CommandContext, "fs" | "signal" | "registerCleanup">;

export function bindFileOutputBudget(context: Pick<CommandContext, "registerCleanup">, budget: (sink: ByteSink) => ByteSink, countedWrite?: CountedFileWrite): void {
  if (!context.registerCleanup) throw new TypeError("Shell output budgets require invocation cleanup ownership");
  filesystemOutputBudgets.set(context.registerCleanup, { sinkBudget: budget, ...(countedWrite === undefined ? {} : { countedWrite }) });
}

export function assertCountedFileOutput(context: Pick<CommandContext, "registerCleanup" | "signal">): void {
  context.signal.throwIfAborted();
  const budget = context.registerCleanup && filesystemOutputBudgets.get(context.registerCleanup);
  if (budget && !budget.countedWrite) throw new FsError("ENOTSUP", { syscall: "write", message: "counted filesystem output budget is not bound" });
}

export async function writeFileOutputCounted(context: Pick<CommandContext, "registerCleanup" | "signal">,
  chunk: Uint8Array, write: () => Promise<number>): Promise<number> {
  assertCountedFileOutput(context);
  if (!(chunk instanceof Uint8Array)) throw new TypeError("Filesystem output must be Uint8Array");
  const budget = context.registerCleanup && filesystemOutputBudgets.get(context.registerCleanup);
  const requested = chunk.byteLength;
  let called = false;
  let accepting = true;
  let accepted: number | undefined;
  let active: Promise<number> | undefined;
  const guarded = (): Promise<number> => {
    try {
      context.signal.throwIfAborted();
      if (!accepting) throw new FsError("EBADF", { syscall: "write" });
      if (called) throw new FsError("EIO", { syscall: "write", message: "counted writer invoked more than once" });
      called = true;
    } catch (error) { return Promise.reject(error); }
    active = (async () => {
      const count = await write();
      context.signal.throwIfAborted();
      if (!Number.isSafeInteger(count) || count < 0 || count > requested) throw new FsError("EIO", { syscall: "write", message: "invalid byte count" });
      accepted = count;
      return count;
    })();
    void active.catch(() => {});
    return active;
  };
  let result: number | undefined;
  let failure: { reason: unknown } | undefined;
  try {
    result = await (budget?.countedWrite ? budget.countedWrite(chunk, guarded) : guarded());
  } catch (reason) { failure = { reason }; }
  accepting = false;
  try { await active; } catch (reason) { failure ??= { reason }; }
  context.signal.throwIfAborted();
  if (failure) throw failure.reason;
  if (accepted === undefined || result !== accepted) throw new FsError("EIO", { syscall: "write", message: "counted writer changed the accepted byte count" });
  return accepted;
}

export interface FileOutput {
  readonly sink: ByteSink;
  readonly signal: AbortSignal;
  finish(): Promise<void>;
  abort(reason: unknown): Promise<void>;
}

export interface FileOutputOpenOptions {
  readonly flag: "w" | "a" | "wx";
  readonly mode?: number;
}

export async function openFileOutput(context: FileOutputContext, path: string, options: "w" | "a" | FileOutputOpenOptions, incremental?: () => Promise<ByteSink>): Promise<FileOutput> {
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
