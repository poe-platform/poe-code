import { CommandRegistry, toByteSource, type ByteSource, type CommandContext, type CommandHandler, type FileSystem } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";

export async function fixture(files: Record<string, string | Uint8Array> = {}): Promise<MemoryFileSystem> {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  for (const [path, contents] of Object.entries(files)) {
    const absolute = path.startsWith("/") ? path : `/work/${path}`;
    await fs.mkdir(absolute.slice(0, absolute.lastIndexOf("/")) || "/", { recursive: true });
    await fs.writeFile(absolute, typeof contents === "string" ? new TextEncoder().encode(contents) : contents);
  }
  return fs;
}

export interface RunOptions {
  readonly fs?: FileSystem;
  readonly stdin?: string | Uint8Array | ByteSource;
  readonly env?: Record<string, string>;
  readonly cwd?: string;
  readonly signal?: AbortSignal;
  readonly execute?: CommandHandler;
}

export async function run(command: string, args: readonly string[] = [], options: RunOptions = {}) {
  const fs = options.fs ?? await fixture();
  const registry = new CommandRegistry();
  await standardCommands(options.execute ? { execute: options.execute } : {}).setup({ commands: registry, use() {}, registerFileSystem() {} });
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command, args, cwd: options.cwd ?? "/work", env: options.env ?? {}, fs,
    signal: options.signal ?? new AbortController().signal,
    stdin: typeof options.stdin === "string" || options.stdin instanceof Uint8Array || options.stdin === undefined
      ? toByteSource(options.stdin ?? "") : options.stdin,
    stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
    stderr: { async write(chunk) { stderr.push(chunk.slice()); } },
  };
  const result = await registry.get(command)!.execute(context);
  const stdoutBytes = Buffer.concat(stdout);
  const stderrBytes = Buffer.concat(stderr);
  return { ...result, stdout: stdoutBytes.toString(), stderr: stderrBytes.toString(), stdoutBytes, stderrBytes, fs, context };
}

export async function* chunks(text: string | Uint8Array, width = 1): ByteSource {
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
  for (let offset = 0; offset < bytes.length; offset += width) yield bytes.slice(offset, offset + width);
}
