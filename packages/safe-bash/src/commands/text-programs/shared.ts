import { monotonicNow, yieldTurn } from "../../contracts/yield.js";
import { FsError, readBytes, writeBytes, type ByteSource, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { inputRequirements } from "../portable-requirements.js";
import { requiredFileInput } from "../search/requirements.js";

export interface TextProgramOptions {
  readonly replace?: boolean;
  readonly maxSteps?: number;
  readonly maxBufferBytes?: number;
}

export class ProgramError extends Error {}

export class Budget {
  readonly maxBufferBytes: number;
  private remaining: number;
  private checkpoints = 0;
  private lastYield = monotonicNow();
  constructor(readonly context: CommandContext, options: TextProgramOptions) {
    this.remaining = options.maxSteps ?? 5_000_000;
    this.maxBufferBytes = options.maxBufferBytes ?? 32 * 1024 * 1024;
    for (const value of [this.remaining, this.maxBufferBytes]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new ProgramError("limits must be positive safe integers");
    }
  }
  step(count = 1): void {
    this.context.signal.throwIfAborted();
    this.remaining -= count;
    if (this.remaining < 0) throw new ProgramError("execution step limit exceeded");
  }
  check(text: string): string {
    if (text.length > this.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    return text;
  }
  async checkpoint(): Promise<void> {
    this.context.signal.throwIfAborted();
    if (++this.checkpoints % 256 === 0 || monotonicNow() - this.lastYield >= 25) {
      await yieldTurn(this.context.signal);
      this.lastYield = monotonicNow();
    }
    this.context.signal.throwIfAborted();
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

export async function* input(context: CommandContext, file = "-"): ByteSource {
  context.signal.throwIfAborted();
  if (file === "-") yield* readBytes(context.stdin, context.signal);
  else {
    yield* requiredFileInput(context, inputRequirements, "file", file, 32 * 1024 * 1024);
  }
}

export async function readProgram(context: CommandContext, file: string): Promise<string> {
  const contents = await context.fs.readFile(virtualPath(context, file), { signal: context.signal, maxBytes: 1024 * 1024 });
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

export function command(name: string, run: (context: CommandContext) => Promise<number>): CommandDefinition {
  return {
    name,
    async execute(context) {
      context.signal.throwIfAborted();
      try { return { exitCode: await run(context) }; }
      catch (error) {
        context.signal.throwIfAborted();
        await writeBytes(context.stderr, new TextEncoder().encode(`${name}: ${error instanceof Error ? error.message : String(error)}\n`), context.signal);
        return { exitCode: error instanceof ProgramError ? 2 : 1 };
      }
    },
  };
}
