import { writeDiagnostic } from "../../escaping.js";
import { yieldTurn } from "../../contracts/yield.js";
import { readBytes, writeBytes, type ByteSource, type CommandContext } from "../../contracts/index.js";
import { SearchError, type SearchOptions } from "./options.js";
import { assertPathRequirements, searchRequirements } from "./requirements.js";

export function pathFor(context: CommandContext, path: string): string {
  if (!path || path.includes("\0")) throw new SearchError("invalid empty or NUL-containing path");
  return path.startsWith("/") ? path : `${context.cwd.replace(/\/$/u, "")}/${path}`;
}

export class OutputClosed extends SearchError {}

export class Limits {
  readonly maxOutputBytes: number;
  readonly maxLineBytes: number;
  readonly maxFileBytes: number;
  readonly maxFiles: number;
  outputBytes = 0;
  files = 0;
  private ticks = 0;
  private readonly stopped = new AbortController();
  readonly signal: AbortSignal;
  constructor(readonly context: CommandContext, options: SearchOptions) {
    this.signal = AbortSignal.any([context.signal, this.stopped.signal]);
    this.maxOutputBytes = options.maxOutputBytes ?? 16 * 1024 * 1024;
    this.maxLineBytes = options.maxLineBytes ?? 1024 * 1024;
    this.maxFileBytes = options.maxFileBytes ?? 64 * 1024 * 1024;
    this.maxFiles = options.maxFiles ?? 100000;
    for (const limit of [this.maxOutputBytes, this.maxLineBytes, this.maxFileBytes, this.maxFiles]) {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new SearchError("search limits must be positive safe integers");
    }
  }
  async tick(): Promise<void> {
    this.context.signal.throwIfAborted();
    if (++this.ticks % 128 === 0) await yieldTurn(this.context.signal);
  }
  private async write(chunk: Uint8Array): Promise<void> {
    try { await writeBytes(this.context.stdout, chunk, this.signal); }
    catch (error) {
      this.context.signal.throwIfAborted();
      if ((error as { code?: string }).code === "EPIPE") {
        const closed = new OutputClosed("stdout closed"); this.stopped.abort(closed); throw closed;
      }
      throw error;
    }
  }
  async output(value: string | Uint8Array): Promise<void> {
    const chunk = typeof value === "string" ? Buffer.from(value) : value;
    if (this.outputBytes + chunk.byteLength > this.maxOutputBytes) throw new SearchError("output byte limit exceeded");
    await this.write(chunk);
    this.outputBytes += chunk.byteLength;
  }
}

export async function* fileInput(context: CommandContext, path: string, limits: Limits): ByteSource {
  await assertPathRequirements(context, searchRequirements, ["file"], [path]);
  if (context.fs.readStream) yield* readBytes(context.fs.readStream(path, { signal: context.signal }), limits.signal);
  else yield await context.fs.readFile(path, { signal: context.signal, maxBytes: limits.maxFileBytes });
}

export async function diagnostic(context: CommandContext, error: unknown): Promise<void> {
  await writeDiagnostic(context.stderr, `rg: ${error instanceof Error ? error.message : String(error)}\n`, context.signal);
}

export interface Line { readonly bytes: Buffer; readonly content: Buffer; readonly number: number; readonly offset: number }
export interface ReadState { bytesRead: number; bytesSearched: number; binaryOffset: number | null; skipped: boolean }

export async function* lines(source: ByteSource, limits: Limits, state: ReadState, binary: "skip" | "binary" | "text", nullData: boolean): AsyncGenerator<Line> {
  let pending = Buffer.alloc(0);
  let offset = 0;
  let number = 0;
  const delimiter = nullData ? 0 : 10;
  for await (const data of readBytes(source, limits.signal)) {
    await limits.tick();
    const chunk = Buffer.from(data);
    if (state.bytesRead + chunk.length > limits.maxFileBytes) throw new SearchError("input file byte limit exceeded");
    const nul = nullData || binary === "text" ? -1 : chunk.indexOf(0);
    if (nul >= 0 && state.binaryOffset === null) state.binaryOffset = state.bytesRead + nul;
    state.bytesRead += chunk.length;
    if (nul >= 0 && binary === "skip") { state.skipped = true; return; }
    let start = 0;
    for (let end = 0; end < chunk.length; end++) {
      if (chunk[end] !== delimiter && !(binary === "binary" && chunk[end] === 0)) continue;
      if (pending.length + end - start > limits.maxLineBytes) throw new SearchError("line byte limit exceeded");
      const content = Buffer.concat([pending, chunk.subarray(start, end)]);
      const bytes = Buffer.concat([content, Buffer.from([delimiter])]);
      state.bytesSearched = offset + bytes.length;
      yield { content, bytes, number: ++number, offset };
      offset += bytes.length; pending = Buffer.alloc(0); start = end + 1;
    }
    if (pending.length + chunk.length - start > limits.maxLineBytes) throw new SearchError("line byte limit exceeded");
    pending = Buffer.concat([pending, chunk.subarray(start)]);
  }
  if (pending.length) { state.bytesSearched = offset + pending.length; yield { bytes: pending, content: pending, number: ++number, offset }; }
}
