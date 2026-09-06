import { writeDiagnostic } from "../../escaping.js";
import { FsError, isFsError, collectBytes, type ByteSource, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { Budget, Cursor, interruptible } from "./io.js";
import { Names } from "./names.js";
import { Outputs } from "./outputs.js";
import { parseArguments, type SplitArguments, type SplitLimits } from "./options.js";

async function* segment(cursor: Cursor, args: SplitArguments): AsyncGenerator<Uint8Array> {
  let remaining = args.size;
  while (remaining > 0) {
    const bytes = await cursor.peek();
    if (!bytes.length) break;
    let count = args.mode === "bytes" ? Math.min(remaining, bytes.length) : bytes.length;
    if (args.mode === "lines") {
      for (let offset = 0; offset < bytes.length; offset++) {
        if (bytes[offset] === 10 && --remaining === 0) { count = offset + 1; break; }
      }
    } else remaining -= count;
    await cursor.budget.step(count);
    yield cursor.take(count);
  }
}

class LineBytes {
  private readonly buffer: Uint8Array;
  private used = 0;
  constructor(private readonly cursor: Cursor, private readonly size: number) { this.buffer = new Uint8Array(size); }
  async next(): Promise<Uint8Array> {
    while (this.used < this.size) {
      const bytes = await this.cursor.peek();
      if (!bytes.length) break;
      const count = Math.min(bytes.length, this.size - this.used);
      await this.cursor.budget.step(count);
      this.buffer.set(this.cursor.take(count), this.used);
      this.used += count;
    }
    let count = this.used;
    if (this.used === this.size) {
      for (let offset = this.used - 1; offset >= 0; offset--) {
        if (this.buffer[offset] === 10) { count = offset + 1; break; }
      }
    }
    const result = this.buffer.slice(0, count);
    this.buffer.copyWithin(0, count, this.used);
    this.used -= count;
    return result;
  }
}

async function run(context: CommandContext, limits: SplitLimits): Promise<void> {
  const args = parseArguments(context.args, limits);
  const controller = new AbortController();
  const signal = AbortSignal.any([context.signal, controller.signal]);
  const budget = new Budget(limits, signal);
  const outputs = new Outputs(context, budget);
  const names = new Names(args, limits);
  let cursor: Cursor | undefined;
  try {
    await outputs.prepareInput(args.input);
    let name = names.next();
    let initial: Awaited<ReturnType<Outputs["prepare"]>> | undefined;
    let initialDirectoryError: FsError | undefined;
    if (args.input !== "-") {
      try { initial = await outputs.prepare(name); }
      catch (error) {
        signal.throwIfAborted();
        if (!isFsError(error, "EISDIR")) throw error;
        initialDirectoryError = error;
      }
    }
    cursor = new Cursor(context, args.input, budget);
    const window = args.mode === "line-bytes" ? new LineBytes(cursor, args.size) : undefined;
    let files = 0;
    while (true) {
      const chunks = window ? (async function* (): AsyncGenerator<Uint8Array> {
        const bytes = await window.next();
        for (let offset = 0; offset < bytes.length; offset += limits.maxChunkBytes) yield bytes.slice(offset, offset + limits.maxChunkBytes);
      })() : segment(cursor, args);
      const first = await chunks.next();
      if (first.done) break;
      budget.check(++files, limits.maxFiles, "file");
      if (files > 1) name = names.next();
      if (files === 1 && initialDirectoryError) throw initialDirectoryError;
      const destination = files === 1 && initial ? initial : await outputs.prepare(name);
      const source = (async function* (): ByteSource {
        budget.output(first.value.length);
        yield first.value;
        for await (const chunk of chunks) {
          budget.output(chunk.length);
          yield chunk;
        }
      })();
      if (context.fs.writeStream && context.fs.capabilities.streamingWrite !== false) {
        await interruptible(() => context.fs.writeStream!(destination.path, source, { signal, flag: destination.flag }), signal);
      } else {
        const bytes = await collectBytes(source, { signal, maxBytes: limits.maxBufferBytes });
        await interruptible(() => context.fs.writeFile(destination.path, bytes, { signal, flag: destination.flag }), signal);
      }
      await outputs.remember(destination.path);
    }
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    cursor?.close();
  }
}

export function createSplitCommand(limits: SplitLimits): CommandDefinition {
  return { name: "split", async execute(context) {
    context.signal.throwIfAborted();
    try {
      await run(context, limits);
      context.signal.throwIfAborted();
      return { exitCode: 0 };
    } catch (error) {
      context.signal.throwIfAborted();
      const message = error instanceof FsError ? error.message.slice(error.code.length + 2) : error instanceof Error ? error.message : String(error);
      await writeDiagnostic(context.stderr, `split: ${message.slice(0, 4096)}\n`, context.signal);
      return { exitCode: 1 };
    }
  } };
}
