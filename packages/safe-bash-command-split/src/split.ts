import { bytesFrom } from "safe-bash-byte-engine";
import { publicDiagnosticMessage } from "safe-bash-contracts/diagnostics";
import { quoteShellOperand, writeDiagnostic } from "safe-bash-contracts/escaping";
import { FsError, isFsError, collectBytes, getCommandArguments, type ByteSource, type CommandContext, type CommandDefinition } from "safe-bash-contracts";
import { Budget, Cursor, interruptible } from "./io.js";
import { Names } from "./names.js";
import { Outputs } from "./outputs.js";
import { parseArguments, settings, type SplitArguments, type SplitLimits } from "./options.js";
import { gnuInformation, gnuInformationSync } from "safe-bash-io-engine/gnu-information";
import { builtInDirectContextExecutors, syncCommandEvaluators } from "safe-bash-io-engine/internal";

async function* segment(cursor: Cursor, args: SplitArguments): AsyncGenerator<Uint8Array> {
  let remaining = args.size;
  while (remaining > 0) {
    const bytes = await cursor.peek();
    if (!bytes.length) break;
    let count = args.mode === "bytes" ? (remaining < bytes.length ? Number(remaining) : bytes.length) : bytes.length;
    if (args.mode === "lines") {
      for (let offset = 0; offset < bytes.length; offset++) {
        if (bytes[offset] === args.separator && --remaining === 0n) { count = offset + 1; break; }
      }
    } else remaining -= BigInt(count);
    { const s = cursor.budget.step(count); if (s) await s; }
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
      { const s = this.cursor.budget.step(count); if (s) await s; }
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

function chunkBoundary(length: number, count: number, index: number): number {
  return Math.floor(length / count) * index + Math.min(index, length % count);
}

async function run(context: CommandContext, limits: SplitLimits): Promise<void> {
  const args = parseArguments(context.args, limits, getCommandArguments(context));
  if ("information" in args) {
    await gnuInformation("split", { ...context, args: [`--${args.information}`] });
    return;
  }
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
    const window = args.mode === "line-bytes" ? new LineBytes(cursor, Number(args.size), args.separator) : undefined;
    let chunkInput: Uint8Array | undefined;
    if (args.mode === "chunks") {
      const source = (async function* (): ByteSource {
        while (true) {
          const bytes = await cursor!.peek();
          if (!bytes.length) break;
          { const s = budget.step(bytes.length); if (s) await s; }
          yield cursor!.take(bytes.length);
        }
      })();
      chunkInput = await collectBytes(source, { signal, ...(Number.isFinite(limits.maxBufferBytes) ? { maxBytes: limits.maxBufferBytes } : {})});
    }
    const size = Number(args.size);
    const records = new Map<number, [number, number][]>();
    if (chunkInput && args.chunkMode === "round-robin") {
      let start = 0, record = 0;
      for (let offset = 0; offset < chunkInput.length; offset++) {
        { const s = budget.step(1); if (s) await s; }
        if (chunkInput[offset] !== args.separator && offset + 1 !== chunkInput.length) continue;
        const index = record++ % size;
        if (args.selectedChunk && index !== args.selectedChunk - 1) { start = offset + 1; continue; }
        const ranges = records.get(index) ?? [];
        ranges.push([start, offset + 1]);
        records.set(index, ranges);
        start = offset + 1;
      }
    }
    let files = 0;
    let chunkIndex = args.selectedChunk ? args.selectedChunk - 1 : 0;
    let chunkOffset = chunkInput ? chunkBoundary(chunkInput.length, size, chunkIndex) : 0;
    const lineBoundary = async (data: Uint8Array, end: number) => {
      while (end < data.length && end > 0 && data[end - 1] !== args.separator) {
        const step = budget.step();
        if (step) await step;
        end++;
      }
      return end;
    };
    if (chunkInput && chunkIndex && args.chunkMode === "lines") chunkOffset = await lineBoundary(chunkInput, chunkOffset);
    while (true) {
      if (chunkInput && chunkIndex === size) break;
      if (chunkInput && args.elideEmpty && !args.selectedChunk &&
        (args.chunkMode === "round-robin" ? chunkIndex === records.size : chunkOffset === chunkInput.length)) break;
      const chunks = chunkInput ? (async function* (): AsyncGenerator<Uint8Array> {
        if (args.chunkMode === "round-robin") {
          for (const [start, end] of records.get(chunkIndex) ?? []) {
            for (let offset = start; offset < end; offset += limits.maxChunkBytes) yield chunkInput.subarray(offset, Math.min(end, offset + limits.maxChunkBytes));
          }
          return;
        }
        let end = chunkBoundary(chunkInput.length, size, chunkIndex + 1);
        if (args.chunkMode === "lines") end = await lineBoundary(chunkInput, Math.max(end, chunkOffset));
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
        if (!first.done) { budget.output(first.value.length); await context.stdout.write(first.value); }
        for await (const chunk of chunks) { budget.output(chunk.length); await context.stdout.write(chunk); }
        break;
      }
      if (first.done && args.elideEmpty) continue;
      budget.check(++files, limits.maxFiles, "file");
      if (files > 1) name = names.next();
      if (files === 1 && initialDirectoryError) throw initialDirectoryError;
      const destination = files === 1 && initial ? initial : await outputs.prepare(name);
      if (args.verbose) {
        const line = bytesFrom(`creating file ${quoteShellOperand(name)}\n`);
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


export function evalSyncSplit(
  inBytes: Uint8Array | undefined,
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  try {
    const limits = settings({});
    const args = parseArguments(opArgs, limits);
    if ("information" in args) return gnuInformationSync("split", [`--${args.information}`]);
    if (args.input === "-" && inBytes === undefined) return undefined;
    const src = args.input === "-" ? inBytes! : readFileSync?.(args.input);
    if (!src) return undefined;
    // A synchronous input is a single bounded byte array; larger counts cannot split it.
    const size = Number(args.size);
    const fatalDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    const decodeSyncSlice = (bytes: Uint8Array): string | undefined => {
      if (bytes.includes(0)) return undefined;
      try { return fatalDecoder.decode(bytes); } catch { return undefined; }
    };
    if (args.selectedChunk > 0) {
      const ci = args.selectedChunk - 1;
      if (args.chunkMode === "round-robin") {
        const parts: Uint8Array[] = [];
        let start = 0;
        let record = 0;
        for (let offset = 0; offset < src.length; offset++) {
          if (src[offset] !== args.separator && offset + 1 !== src.length) continue;
          if (record++ % size === ci) {
            parts.push(src.subarray(start, offset + 1));
          }
          start = offset + 1;
        }
        const total = parts.reduce((sum, p) => sum + p.length, 0);
        const merged = new Uint8Array(total);
        let off = 0;
        for (const p of parts) {
          merged.set(p, off);
          off += p.length;
        }
        return decodeSyncSlice(merged);
      }
      const boundary = (index: number, minimum: number) => {
        let end = Math.max(minimum, chunkBoundary(src.length, size, index));
        if (args.chunkMode === "lines") {
          while (end > 0 && end < src.length && src[end - 1] !== args.separator) end++;
        }
        return end;
      };
      const start = boundary(ci, 0);
      return decodeSyncSlice(src.subarray(start, boundary(ci + 1, start)));
    }
    if (!writeFileSync) return undefined;
    const names = new Names(args, limits);
    const chunks: Uint8Array[] = [];
    if (args.mode === "bytes") {
      for (let off = 0; off < src.length; off += size) {
        chunks.push(src.subarray(off, Math.min(src.length, off + size)));
      }
    } else if (args.mode === "lines") {
      let start = 0;
      let lines = 0;
      for (let off = 0; off < src.length; off++) {
        if (src[off] === args.separator && ++lines === size) {
          chunks.push(src.subarray(start, off + 1));
          start = off + 1;
          lines = 0;
        }
      }
      if (start < src.length) chunks.push(src.subarray(start));
    } else if (args.mode === "line-bytes") {
      let pos = 0;
      let bufParts: Uint8Array[] = [];
      let bufLen = 0;
      const flushBuf = () => {
        if (bufLen === 0) return;
        const merged = new Uint8Array(bufLen);
        let o = 0;
        for (const p of bufParts) { merged.set(p, o); o += p.length; }
        chunks.push(merged);
        bufParts = [];
        bufLen = 0;
      };
      while (pos < src.length) {
        let end = pos;
        while (end < src.length && src[end] !== args.separator) end++;
        if (end < src.length) end++;
        let lineSlice = src.subarray(pos, end);
        pos = end;
        while (lineSlice.length > size) {
          flushBuf();
          chunks.push(lineSlice.subarray(0, size));
          lineSlice = lineSlice.subarray(size);
        }
        if (bufLen + lineSlice.length > size) flushBuf();
        if (lineSlice.length > 0) {
          bufParts.push(lineSlice);
          bufLen += lineSlice.length;
        }
      }
      flushBuf();
    } else if (args.mode === "chunks") {
      if (args.chunkMode === "round-robin") {
        const buckets: Uint8Array[][] = [];
        let start = 0;
        let rec = 0;
        for (let off = 0; off < src.length; off++) {
          if (src[off] !== args.separator && off + 1 !== src.length) continue;
          const index = rec++ % size;
          (buckets[index] ??= []).push(src.subarray(start, off + 1));
          start = off + 1;
        }
        for (let i = 0; i < (args.elideEmpty ? buckets.length : size); i++) {
          const b = buckets[i] ?? [];
          const total = b.reduce((s, p) => s + p.length, 0);
          const merged = new Uint8Array(total);
          let o = 0;
          for (const p of b) { merged.set(p, o); o += p.length; }
          chunks.push(merged);
        }
      } else {
        let chunkOffset = 0;
        for (let idx = 0; idx < size && (!args.elideEmpty || chunkOffset < src.length); idx++) {
          let end = chunkBoundary(src.length, size, idx + 1);
          if (args.chunkMode === "lines") {
            end = Math.max(end, chunkOffset);
            while (end < src.length && end > 0 && src[end - 1] !== args.separator) end++;
          }
          chunks.push(src.subarray(chunkOffset, end));
          chunkOffset = end;
        }
      }
    } else {
      return undefined;
    }
    const normInput = args.input === "-" ? undefined : args.input.replace(/^\.\/+/, "");
    const planned: Array<{ fileName: string; chunk: Uint8Array }> = [];
    for (const chunk of chunks) {
      if (chunk.length === 0 && args.elideEmpty) continue;
      const fileName = names.next();
      if (!fileName || fileName.endsWith("/") || fileName.endsWith("/.") || fileName.includes("/./") || /(?:^|\/)\.\.(?:\/|$)/u.test(fileName)) return undefined;
      const normOut = fileName.replace(/^\.\/+/, "");
      if (normInput !== undefined && (normOut === normInput || readFileSync?.(fileName) === src)) return undefined;
      planned.push({ fileName, chunk });
    }
    const created: string[] = [];
    for (const { fileName, chunk } of planned) {
      if (!writeFileSync(fileName, chunk)) return undefined;
      created.push(fileName);
    }
    return args.verbose ? created.map(n => `creating file ${quoteShellOperand(n)}\n`).join("") : "";
  } catch {
    return undefined;
  }
}

syncCommandEvaluators.evalSyncSplit = evalSyncSplit;

export function createSplitCommand(limits: SplitLimits): CommandDefinition {
  const def: CommandDefinition = { name: "split", async execute(context) {
    context.signal.throwIfAborted();
    try {
      const profile = (context.capabilities?.commandLimits as { split?: Partial<SplitLimits> } | undefined)?.split;
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
  builtInDirectContextExecutors.add(def.execute);
  return def;
}
