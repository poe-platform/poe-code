import { CommandRegistry, toByteSource, type ByteSink, type ByteSource, type CommandContext, type FileSystem } from "../../../../src/contracts/index.js";
import { createEncodingCommands } from "../../../../src/commands/bytes/encoding/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";

export const allBytes = Uint8Array.from({ length: 256 }, (_, index) => index);
export const registry = new CommandRegistry(createEncodingCommands());

export async function* sliced(bytes: Uint8Array, width = 1): ByteSource {
  yield new Uint8Array();
  for (let offset = 0; offset < bytes.length; offset += width) {
    const backing = new Uint8Array(width + 10);
    const length = Math.min(width, bytes.length - offset);
    backing.set(bytes.subarray(offset, offset + length), 5);
    yield backing.subarray(5, 5 + length);
    yield new Uint8Array();
  }
}

export async function run(name: string, args: readonly string[] = [], input: string | Uint8Array | ByteSource = "", overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: name, args, cwd: "/", env: {}, fs: new MemoryFileSystem(),
    stdin: typeof input === "string" || input instanceof Uint8Array ? toByteSource(input) : input,
    stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
    stderr: { async write(chunk) { stderr.push(chunk.slice()); } },
    signal: new AbortController().signal, ...overrides,
  };
  const result = await registry.get(name)!.execute(context);
  return { ...result, stdout: Buffer.concat(stdout).toString(), bytes: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString(), context };
}

export function withStream(source: ByteSource, observed?: (path: string, signal: AbortSignal | undefined) => void): FileSystem {
  const fs = new MemoryFileSystem();
  fs.readFile = async () => { throw new Error("readFile fallback forbidden"); };
  fs.readStream = (path, options) => { observed?.(path, options?.signal); return source; };
  return fs;
}

export function countingSink(): ByteSink & { size: number; largest: number; writes: number } {
  return { size: 0, largest: 0, writes: 0, async write(chunk) {
    this.size += chunk.length; this.largest = Math.max(this.largest, chunk.length); this.writes++;
  } };
}
