import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { columnCommands, createColumnCommand, type ColumnCommandsOptions } from "../../../src/commands/column/index.js";

export async function run(args: readonly string[] = [], input: string | Uint8Array = "", options: ColumnCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "column", args, cwd: "/", env: {}, fs: createMemoryFileSystem(),
    signal: new AbortController().signal, stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout.push(Uint8Array.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Uint8Array.from(bytes)); } }, ...overrides,
  };
  const result = await createColumnCommand(options).execute(context);
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), stdoutBytes: Buffer.concat(stdout), context };
}

export function shell(options: ColumnCommandsOptions = {}): Shell {
  return new Shell({ fs: createMemoryFileSystem() }).use(standardCommands()).use(columnCommands(options));
}

export function deferred<Value = void>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}
