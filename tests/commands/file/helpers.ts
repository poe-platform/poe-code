import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { toByteSource, type CommandContext, type FileSystem } from "../../../src/contracts/index.js";
import { createFileCommand, type FileCommandsOptions } from "../../../src/commands/file/index.js";

export async function run(args: readonly string[], options: FileCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = { command: "file", args, cwd: "/", fs: createMemoryFileSystem(), env: {},
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } }, stderr: { async write(bytes) { stderr.push(bytes.slice()); } }, ...overrides };
  const result = await createFileCommand(options).execute(context);
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(),
    stdoutBytes: Buffer.concat(stdout), stderrBytes: Buffer.concat(stderr) };
}

export function proxyFs(fs: FileSystem, overrides: Partial<Record<keyof FileSystem, unknown>>): FileSystem {
  return new Proxy(fs, { get(target, property) {
    if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
    const value: unknown = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
