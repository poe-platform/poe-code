import { FsError, type ByteSource, type CommandContext, type CommandDefinition } from "../../contracts/index.js";

export interface TextProgramOptions {
  readonly replace?: boolean;
  readonly maxSteps?: number;
  readonly maxBufferBytes?: number;
}

export class ProgramError extends Error {}

export class Budget {
  readonly maxBufferBytes: number;
  private remaining: number;
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
  await context.stdout.write(bytes(text));
}

export async function* input(context: CommandContext, file = "-"): ByteSource {
  context.signal.throwIfAborted();
  if (file === "-") yield* context.stdin;
  else {
    const path = virtualPath(context, file);
    if (context.fs.readStream) yield* context.fs.readStream(path, { signal: context.signal });
    else yield await context.fs.readFile(path, { signal: context.signal, maxBytes: 32 * 1024 * 1024 });
  }
}

export async function readProgram(context: CommandContext, file: string): Promise<string> {
  const contents = await context.fs.readFile(virtualPath(context, file), { signal: context.signal, maxBytes: 1024 * 1024 });
  return Buffer.from(contents).toString("latin1");
}

export interface RecordLine { readonly text: string; readonly terminated: boolean; readonly file: string }

export async function* lineRecords(context: CommandContext, files: readonly string[], budget: Budget): AsyncGenerator<RecordLine> {
  for (const file of files.length ? files : ["-"]) {
    let pending = "";
    for await (const chunk of input(context, file)) {
      budget.step();
      const text = Buffer.from(chunk).toString("latin1");
      let start = 0;
      let end: number;
      while ((end = text.indexOf("\n", start)) >= 0) {
        yield { text: budget.check(pending + text.slice(start, end)), terminated: true, file };
        pending = ""; start = end + 1;
      }
      pending = budget.check(pending + text.slice(start));
    }
    if (pending) yield { text: pending, terminated: false, file };
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
        await context.stderr.write(new TextEncoder().encode(`${name}: ${error instanceof Error ? error.message : String(error)}\n`));
        return { exitCode: error instanceof ProgramError ? 2 : 1 };
      }
    },
  };
}
