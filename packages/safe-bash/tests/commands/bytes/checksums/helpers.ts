import { CommandRegistry, toByteSource, type ByteSink, type ByteSource, type FileSystem } from "../../../../src/contracts/index.js";
import { createChecksumCommands } from "../../../../src/commands/bytes/checksums/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";

export const encoder = new TextEncoder();
export const registry = new CommandRegistry(createChecksumCommands());

export async function fixture(files: Readonly<Record<string, string | Uint8Array>> = {}): Promise<MemoryFileSystem> {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  for (const [name, data] of Object.entries(files)) {
    await fs.writeFile(`/work/${name}`, typeof data === "string" ? encoder.encode(data) : data);
  }
  return fs;
}

export interface RunOptions {
  fs?: FileSystem;
  stdin?: string | Uint8Array | ByteSource;
  stdout?: ByteSink;
  stderr?: ByteSink;
  signal?: AbortSignal;
}

export async function run(name: string, args: readonly string[] = [], settings: RunOptions = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const input = settings.stdin ?? "";
  const result = await registry.get(name)!.execute({
    command: name, args, cwd: "/work", env: {}, fs: settings.fs ?? await fixture(),
    signal: settings.signal ?? new AbortController().signal,
    stdin: typeof input === "string" || input instanceof Uint8Array ? toByteSource(input) : input,
    stdout: settings.stdout ?? { async write(chunk) { stdout.push(chunk.slice()); } },
    stderr: settings.stderr ?? { async write(chunk) { stderr.push(chunk.slice()); } },
  });
  return { ...result, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
}

export function chunks(bytes: Uint8Array, size: number): ByteSource {
  return (async function* () {
    for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size);
  })();
}

export function overrideFs(fs: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(fs, {
    get(target, key) {
      if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
