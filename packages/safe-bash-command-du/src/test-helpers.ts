import { createDuCommand, type DuCommandsOptions } from "./index.js";
import type { CommandContext, FileStat, FileSystem } from "safe-bash-contracts";
import { createMemoryFileSystem } from "@poe-code/safe-fs";

export function wrapped(fs: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(fs, { get(target, property) {
    const value = Object.hasOwn(overrides, property) ? Reflect.get(overrides, property) : Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

export async function seed(fs: FileSystem): Promise<void> {
  await fs.mkdir("/tree/sub", { recursive: true });
  await fs.writeFile("/tree/a", new TextEncoder().encode("abc"));
  await fs.writeFile("/tree/sub/b", new TextEncoder().encode("12345"));
}

export function metadata(fs: FileSystem, transform: (stat: FileStat, path: string) => FileStat): FileSystem {
  return wrapped(fs, { async lstat(path, options) { return transform(await fs.lstat(path, options), path); } });
}

export function trace(fs: FileSystem): { fs: FileSystem; calls: { method: string; path: string; signal?: AbortSignal }[] } {
  const calls: { method: string; path: string; signal?: AbortSignal }[] = [];
  return { calls, fs: new Proxy(fs, { get(target, property) {
    const value = Reflect.get(target, property);
    if (typeof value !== "function") return value;
    return (path: string, options?: { signal?: AbortSignal }) => {
      calls.push({ method: String(property), path, ...(options?.signal ? { signal: options.signal } : {}) });
      if (property !== "lstat" && property !== "readdir") throw new Error(`forbidden command operation: ${String(property)}`);
      return value.call(target, path, options);
    };
  } }) };
}

export async function run(args: readonly string[], options: DuCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = { command: "du", args, cwd: "/", env: {}, fs: createMemoryFileSystem(),
    signal: new AbortController().signal, stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("stdin must remain unread"); } }; } },
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } }, stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } }, ...overrides };
  const result = await createDuCommand(options).execute(context);
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

