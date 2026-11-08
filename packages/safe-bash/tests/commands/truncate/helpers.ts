import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import type { CommandContext, FileSystem } from "../../../src/contracts/index.js";
import { createTruncateCommand, type TruncateCommandsOptions } from "../../../src/commands/truncate/index.js";

export async function run(args: readonly string[], fs: FileSystem = createMemoryFileSystem(), options: TruncateCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "truncate", args, fs, cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: (async function* () { yield await Promise.reject(new Error("truncate must not read stdin")); })(),
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr.push(bytes.slice()); } }, ...overrides,
  };
  const result = await createTruncateCommand(options).execute(context);
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

export function wrapped(fs: FileSystem, overrides: { [Key in keyof FileSystem]?: FileSystem[Key] | undefined }): FileSystem {
  return new Proxy(fs, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

export function withoutBlockMetadata(fs: FileSystem): FileSystem {
  return wrapped(fs, { async stat(path, options) {
    const metadata = { ...await fs.stat(path, options) };
    Reflect.deleteProperty(metadata, "ioBlockSize");
    return metadata;
  } });
}
