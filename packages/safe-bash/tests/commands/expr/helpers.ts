import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createExprCommand, type ExprCommandsOptions } from "../../../src/commands/expr/index.js";
import type { CommandContext } from "../../../src/contracts/index.js";

export async function run(args: readonly string[], options: ExprCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "expr", args, cwd: "/", env: { LC_ALL: "C" }, fs: createMemoryFileSystem(),
    signal: new AbortController().signal,
    stdin: { [Symbol.asyncIterator]() { throw new Error("argv-only expr acquired stdin"); } },
    stdout: { async write(chunk) { stdout.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk) { stderr.push(new Uint8Array(chunk)); } },
    ...overrides,
  };
  const result = await createExprCommand(options).execute(context);
  const output = Buffer.concat(stdout), errors = Buffer.concat(stderr);
  return { ...result, stdout: output.toString(), stdoutHex: output.toString("hex"), stderr: errors.toString(), context };
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
