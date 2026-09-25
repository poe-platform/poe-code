import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { createColumnCommand, type ColumnCommandsOptions } from "./index.js";

export async function run(args: readonly string[] = [], input: string | Uint8Array = "", options: ColumnCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "column", args, cwd: "/", env: {}, fs: {} as CommandContext["fs"],
    signal: new AbortController().signal, stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout.push(Uint8Array.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Uint8Array.from(bytes)); } }, ...overrides,
  };
  const result = await createColumnCommand(options).execute(context);
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), stdoutBytes: Buffer.concat(stdout), context };
}

export function deferred<Value = void>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}
