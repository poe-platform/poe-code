import { PublicDiagnostic, publicDiagnosticMessage } from "../../diagnostics.js";
import { writeDiagnostic } from "../../escaping.js";
import { monotonicNow, yieldTurn } from "../../contracts/yield.js";
import { FsError, readBytes, writeBytes, type ByteSource, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { inputRequirements } from "../portable-requirements.js";
import { requiredFileInput } from "../search/requirements.js";

export interface TextProgramOptions {
  readonly replace?: boolean;
  readonly maxProgramInstructions?: number;
  readonly maxSteps?: number;
  readonly maxBufferBytes?: number | undefined;
  readonly maxArrayEntries?: number;
  readonly maxFields?: number;
  readonly maxGetlineFiles?: number;
  readonly maxRecursionDepth?: number;
  readonly maxArguments?: number;
  readonly maxRetainedBytes?: number;
}

export class ProgramError extends PublicDiagnostic {}

const validatedTextProgramOptions = new WeakSet<TextProgramOptions>();

export class Budget {
  readonly maxBufferBytes: number;
  stepsUsed = 0;
  private remainingSmi: number;
  private remainingNum: number;
  private readonly unlimited: boolean;
  private readonly signal: AbortSignal;
  private checkpoints = 0;
  private lastYield = monotonicNow();
  constructor(readonly context: CommandContext, readonly options: TextProgramOptions) {
    const rem = options.maxSteps ?? Infinity;
    this.unlimited = rem === Infinity;
    this.remainingNum = this.unlimited ? 0 : rem;
    this.remainingSmi = !this.unlimited && rem <= 0x3fffffff ? (rem | 0) : 0x3fffffff;
    this.signal = context.signal;
    this.maxBufferBytes = options.maxBufferBytes ?? Infinity;
    if (!validatedTextProgramOptions.has(options)) {
      for (const [key, value] of Object.entries(options)) {
        if (!key.startsWith("max")) continue;
        if (value !== undefined && (typeof value !== "number" || value !== Infinity && !Number.isSafeInteger(value) || value < 1)) throw new ProgramError("limits must be positive safe integers");
      }
      validatedTextProgramOptions.add(options);
    }
  }
  step(count = 1): void {
    if (this.signal.aborted) this.signal.throwIfAborted();
    this.stepsUsed += count;
    if (this.unlimited) return;
    if ((count | 0) === count && count >= 0 && count <= this.remainingSmi) {
      this.remainingSmi = (this.remainingSmi - (count | 0)) | 0;
      this.remainingNum -= count;
      return;
    }
    if (count > this.remainingNum) throw new ProgramError("execution step limit exceeded");
    this.remainingNum -= count;
    this.remainingSmi = this.remainingNum <= 0x3fffffff ? (this.remainingNum | 0) : 0x3fffffff;
  }
  check(text: string): string {
    if (text.length > this.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    return text;
  }
  async checkpoint(): Promise<void> {
    const p = this.checkpointSync();
    if (p) await p;
  }
  checkpointSync(): Promise<void> | undefined {
    if (this.signal.aborted) this.signal.throwIfAborted();
    const count = ++this.checkpoints;
    if ((count & 255) === 0 || monotonicNow() - this.lastYield >= 25) {
      return this.yieldCheckpointAsync();
    }
    return undefined;
  }
  private async yieldCheckpointAsync(): Promise<void> {
    await yieldTurn(this.signal);
    this.lastYield = monotonicNow();
    this.signal.throwIfAborted();
  }
}

export function byteString(text: string): string { return Buffer.from(text, "utf8").toString("latin1"); }
export function bytes(text: string): Uint8Array { return Buffer.from(text, "latin1"); }

export function virtualPath(context: CommandContext, path: string): string {
  if (!path) throw new FsError("ENOENT", { path });
  if (path.includes("\0")) throw new FsError("EINVAL", { path });
  return path.startsWith("/") ? path : `${context.cwd.replace(/\/$/u, "")}/${path}`;
}

export async function write(context: CommandContext, text: string): Promise<void> {
  context.signal.throwIfAborted();
  await writeBytes(context.stdout, bytes(text), context.signal);
}

export function input(context: CommandContext, file = "-"): ByteSource {
  context.signal.throwIfAborted();
  if (file === "-" || file === "/dev/stdin") return readBytes(context.stdin, context.signal);
  return requiredFileInput(context, inputRequirements, "file", file, Infinity);
}

export async function readProgram(context: CommandContext, file: string): Promise<string> {
  const contents = await context.fs.readFile(virtualPath(context, file), { signal: context.signal });
  return Buffer.from(contents).toString("latin1");
}

export interface RecordLine { readonly text: string; readonly terminated: boolean; readonly file: string; readonly fileIndex: number }

export async function* lineRecords(context: CommandContext, files: readonly string[], budget: Budget): AsyncGenerator<RecordLine> {
  const names = files.length ? files : ["-"];
  for (let fileIndex = 0; fileIndex < names.length; fileIndex++) {
    const file = names[fileIndex]!;
    let pending = "";
    for await (const chunk of input(context, file)) {
      budget.step();
      const text = Buffer.from(chunk).toString("latin1");
      let start = 0;
      let end: number;
      while ((end = text.indexOf("\n", start)) >= 0) {
        yield { text: budget.check(pending + text.slice(start, end)), terminated: true, file, fileIndex };
        pending = ""; start = end + 1;
      }
      pending = budget.check(pending + text.slice(start));
    }
    if (pending) yield { text: pending, terminated: false, file, fileIndex };
  }
}

export interface LineRecordBatch {
  readonly text: string;
  readonly firstLinePrefix: string;
  readonly ends: readonly number[];
  readonly trailingText: string | undefined;
  readonly file: string;
  readonly fileIndex: number;
}

export async function* lineRecordBatches(context: CommandContext, files: readonly string[], budget: Budget): AsyncGenerator<LineRecordBatch> {
  const names = files.length ? files : ["-"];
  for (let fileIndex = 0; fileIndex < names.length; fileIndex++) {
    const file = names[fileIndex]!;
    let pending = "";
    for await (const chunk of input(context, file)) {
      budget.step();
      const text = Buffer.isBuffer(chunk) ? chunk.toString("latin1") : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString("latin1");
      let start = 0;
      let end: number;
      const ends: number[] = [];
      let firstLinePrefix = "";
      while ((end = text.indexOf("\n", start)) >= 0) {
        const len = (ends.length === 0 ? pending.length : 0) + (end - start);
        if (len > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
        if (ends.length === 0 && pending) {
          firstLinePrefix = pending;
          pending = "";
        }
        ends.push(end);
        start = end + 1;
      }
      if (start < text.length) {
        pending = budget.check(pending ? pending + text.slice(start) : text.slice(start));
      }
      if (ends.length > 0) {
        yield { text, firstLinePrefix, ends, trailingText: undefined, file, fileIndex };
      }
    }
    if (pending) {
      yield { text: "", firstLinePrefix: "", ends: [], trailingText: pending, file, fileIndex };
    }
  }
}

export function command(name: string, run: (context: CommandContext) => Promise<number>): CommandDefinition {
  return {
    name,
    async execute(context) {
      context.signal.throwIfAborted();
      try { return { exitCode: await run(context) }; }
      catch (error) {
        context.signal.throwIfAborted();
        await writeDiagnostic(context.stderr, `${name}: ${publicDiagnosticMessage(error, context.onInternalError)}\n`, context.signal);
        return { exitCode: error instanceof ProgramError ? 2 : 1 };
      }
    },
  };
}
