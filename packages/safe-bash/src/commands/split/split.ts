import { publicDiagnosticMessage } from "../../diagnostics.js";
import { writeDiagnostic } from "../../escaping.js";
import { FsError, isFsError, collectBytes, type ByteSource, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { Budget, Cursor, interruptible } from "./io.js";
import { Names } from "./names.js";
import { Outputs } from "./outputs.js";
import { parseArguments, settings, type SplitArguments, type SplitLimits } from "./options.js";
import type { CommandFamilyLimits } from "../limits.js";
import { gnuInformation } from "../gnu-information.js";

async function* segment(cursor: Cursor, args: SplitArguments): AsyncGenerator<Uint8Array> {
  let remaining = args.size;
  while (remaining > 0) {
    const bytes = await cursor.peek();
    if (!bytes.length) break;
    let count = args.mode === "bytes" ? Math.min(remaining, bytes.length) : bytes.length;
    if (args.mode === "lines") {
      for (let offset = 0; offset < bytes.length; offset++) {
        if (bytes[offset] === args.separator && --remaining === 0) { count = offset + 1; break; }
      }
    } else remaining -= count;
    await cursor.budget.step(count);
    yield cursor.take(count);
  }
}

class LineBytes {
  private buffer = new Uint8Array(0);
  private used = 0;
  constructor(private readonly cursor: Cursor, private readonly size: number, private readonly separator: number) {}
  async next(): Promise<Uint8Array> {
    while (this.used < this.size) {
      const bytes = await this.cursor.peek();
      if (!bytes.length) break;
      const count = Math.min(bytes.length, this.size - this.used);
      await this.cursor.budget.step(count);
      const needed = this.used + count;
      if (needed > this.buffer.length) {
        const buffer = new Uint8Array(Math.min(this.size, Math.max(needed, this.buffer.length * 2)));
        buffer.set(this.buffer.subarray(0, this.used));
        this.buffer = buffer;
      }
      this.buffer.set(this.cursor.take(count), this.used);
      this.used += count;
    }
    let count = this.used;
    if (this.used === this.size) {
      for (let offset = this.used - 1; offset >= 0; offset--) {
        if (this.buffer[offset] === this.separator) { count = offset + 1; break; }
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
    let name = args.selectedChunk ? "" : names.next();
    let initial: Awaited<ReturnType<Outputs["prepare"]>> | undefined;
    let initialDirectoryError: FsError | undefined;
    if (args.input !== "-" && !args.selectedChunk) {
      try { initial = await outputs.prepare(name); }
      catch (error) {
        signal.throwIfAborted();
        if (!isFsError(error, "EISDIR")) throw error;
        initialDirectoryError = error;
      }
    }
    cursor = new Cursor(context, args.input, budget);
    const window = args.mode === "line-bytes" ? new LineBytes(cursor, args.size, args.separator) : undefined;
    let chunkInput: Uint8Array | undefined;
    if (args.mode === "chunks") {
      const source = (async function* (): ByteSource {
        while (true) {
          const bytes = await cursor!.peek();
          if (!bytes.length) break;
          await budget.step(bytes.length);
          yield cursor!.take(bytes.length);
        }
      })();
      chunkInput = await collectBytes(source, { signal, ...(Number.isFinite(limits.maxBufferBytes) ? { maxBytes: limits.maxBufferBytes } : {})});
    }
    const records = new Map<number, [number, number][]>();
    if (chunkInput && args.chunkMode === "round-robin") {
      let start = 0, record = 0;
      for (let offset = 0; offset < chunkInput.length; offset++) {
        await budget.step(1);
        if (chunkInput[offset] !== args.separator && offset + 1 !== chunkInput.length) continue;
        const index = record++ % args.size;
        const ranges = records.get(index) ?? [];
        ranges.push([start, offset + 1]);
        records.set(index, ranges);
        start = offset + 1;
      }
    }
    let files = 0;
    let chunkIndex = 0;
    let chunkOffset = 0;
    const chunkSize = chunkInput ? Math.floor(chunkInput.length / args.size) : 0;
    while (true) {
      if (chunkInput && chunkIndex === args.size) break;
      const chunks = chunkInput ? (async function* (): AsyncGenerator<Uint8Array> {
        if (args.chunkMode === "round-robin") {
          for (const [start, end] of records.get(chunkIndex) ?? []) {
            for (let offset = start; offset < end; offset += limits.maxChunkBytes) yield chunkInput.subarray(offset, Math.min(end, offset + limits.maxChunkBytes));
          }
          return;
        }
        let end = chunkSize * (chunkIndex + 1) + Math.min(chunkIndex + 1, chunkInput.length % args.size);
        if (args.chunkMode === "lines") {
          end = Math.max(end, chunkOffset);
          while (end < chunkInput.length && end > 0 && chunkInput[end - 1] !== args.separator) {
            await budget.step(1);
            end++;
          }
        }
        while (chunkOffset < end) {
          const next = Math.min(end, chunkOffset + limits.maxChunkBytes);
          yield chunkInput.slice(chunkOffset, next);
          chunkOffset = next;
        }
      })() : window ? (async function* (): AsyncGenerator<Uint8Array> {
        const bytes = await window.next();
        for (let offset = 0; offset < bytes.length; offset += limits.maxChunkBytes) yield bytes.slice(offset, offset + limits.maxChunkBytes);
      })() : segment(cursor, args);
      const first = await chunks.next();
      if (first.done && !chunkInput) break;
      chunkIndex++;
      if (args.selectedChunk) {
        if (chunkIndex === args.selectedChunk) {
          if (!first.done) { budget.output(first.value.length); await context.stdout.write(first.value); }
          for await (const chunk of chunks) { budget.output(chunk.length); await context.stdout.write(chunk); }
          break;
        }
        for await (const ignoredChunk of chunks) { /* Advance to the selected chunk. */ }
        continue;
      }
      if (first.done && args.elideEmpty) continue;
      budget.check(++files, limits.maxFiles, "file");
      if (files > 1) name = names.next();
      if (files === 1 && initialDirectoryError) throw initialDirectoryError;
      const destination = files === 1 && initial ? initial : await outputs.prepare(name);
      if (args.verbose) {
        const line = Buffer.from(`creating file '${name}'\n`);
        budget.output(line.length);
        await context.stdout.write(line);
      }
      const source = (async function* (): ByteSource {
        if (!first.done) {
          budget.output(first.value.length);
          yield first.value;
        }
        for await (const chunk of chunks) {
          budget.output(chunk.length);
          yield chunk;
        }
      })();
      const capabilities = await interruptible(() => Promise.resolve(context.fs.capabilitiesFor?.(destination.path, { signal }) ?? context.fs.capabilities), signal);
      if (context.fs.writeStream && capabilities.streamingWrite !== false) {
        await interruptible(() => context.fs.writeStream!(destination.path, source, { signal, flag: destination.flag }), signal);
      } else {
        const bytes = await collectBytes(source, { signal, ...(Number.isFinite(limits.maxBufferBytes) ? { maxBytes: limits.maxBufferBytes } : {})});
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
      const info = await gnuInformation("split", context);
      if (info) return info;
      const profile = (context.capabilities?.commandLimits as CommandFamilyLimits | undefined)?.split;
      const effective = { ...limits };
      if (profile) {
        settings({ limits: profile });
        for (const key of Object.keys(profile) as (keyof SplitLimits)[]) effective[key] = Math.min(effective[key], profile[key]!);
      }
      await run(context, effective);
      context.signal.throwIfAborted();
      return { exitCode: 0 };
    } catch (error) {
      context.signal.throwIfAborted();
      const message = error instanceof FsError ? error.message.slice(error.code.length + 2) : publicDiagnosticMessage(error, context.onInternalError);
      await writeDiagnostic(context.stderr, `split: ${message.slice(0, 4096)}\n`, context.signal);
      return { exitCode: 1 };
    }
  } };
}
