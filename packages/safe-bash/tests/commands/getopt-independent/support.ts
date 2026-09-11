import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { createGetoptCommand, type GetoptCommandsOptions } from "../../../src/commands/getopt/index.js";

export async function run(args: readonly string[], options: GetoptCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createGetoptCommand(options).execute({
    command: "getopt", args, env: { LC_ALL: "C", TZ: "UTC" }, cwd: "/", fs: new MemoryFileSystem(),
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout.push(Uint8Array.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Uint8Array.from(bytes)); } },
    ...overrides,
  });
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
