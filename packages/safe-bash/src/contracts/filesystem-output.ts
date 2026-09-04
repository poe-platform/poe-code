import type { CommandContext } from "./command.js";
import { FsError } from "./errors.js";
import { createBytePipe, outputFailure, type BytePipe, type ByteSink, type ByteSource } from "./io.js";
import { createOutputOperation } from "./output.js";

const filesystemOutputBudgets = new WeakMap<NonNullable<CommandContext["registerCleanup"]>, (sink: ByteSink) => ByteSink>();

export type FileOutputContext = Pick<CommandContext, "fs" | "signal" | "registerCleanup">;

export function bindFileOutputBudget(context: Pick<CommandContext, "registerCleanup">, budget: (sink: ByteSink) => ByteSink): void {
  if (!context.registerCleanup) throw new TypeError("Shell output budgets require invocation cleanup ownership");
  filesystemOutputBudgets.set(context.registerCleanup, budget);
}

export interface FileOutput {
  readonly sink: ByteSink;
  readonly signal: AbortSignal;
  finish(): Promise<void>;
  abort(reason: unknown): Promise<void>;
}

export async function openFileOutput(context: FileOutputContext, path: string, flag: "w" | "a", incremental?: () => Promise<ByteSink>): Promise<FileOutput> {
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
  const operation = createOutputOperation(context, budget?.(destination) ?? destination);
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
      try { await fs.access(path, 2, { signal }); }
      catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof FsError) || error.code !== "ENOENT" && error.code !== "ENOTSUP") throw error;
      }
      signal.throwIfAborted();
      const streaming = flag === "a" ? capabilities.streamingAppend ?? capabilities.streamingWrite : capabilities.streamingWrite;
      if (!incremental && streaming !== false && fs.writeStream) {
        try {
          await fs.writeStream(path, source, { flag, signal });
          if (!ended) throw new FsError("EIO", { path, message: "Streaming writer returned before consuming output" });
          return;
        } catch (error) {
          signal.throwIfAborted();
          if (reading || !(error instanceof FsError) || error.code !== "ENOTSUP") throw error;
        }
      }
      if (flag === "w" && capabilities.write === false) throw new FsError("ENOTSUP", { path, syscall: "writeFile" });
      if ((!incremental || flag === "a") && capabilities.append === false) throw new FsError("ENOTSUP", { path, syscall: "appendFile" });
      const sink = incremental ? await incremental() : await (async (): Promise<ByteSink> => {
        if (flag === "a") await fs.appendFile(path, new Uint8Array(), { signal });
        else await fs.writeFile(path, new Uint8Array(), { flag, signal });
        return { write: chunk => fs.appendFile(path, chunk, { signal }) };
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
