import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { toByteSource, type ByteSource, type CommandContext, type CommandDefinition } from "../../../src/contracts/index.js";

export function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}

export async function run(definition: CommandDefinition, args: readonly string[], stdin: string | Uint8Array | ByteSource = "", overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: definition.name, args, fs: new MemoryFileSystem(), cwd: "/", env: {},
    signal: new AbortController().signal, stdinIsDefault: false,
    stdin: typeof stdin === "string" || stdin instanceof Uint8Array ? toByteSource(stdin) : stdin,
    stdout: { async write(bytes) { stdout.push(Uint8Array.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Uint8Array.from(bytes)); } }, ...overrides,
  };
  const result = await definition.execute(context);
  return { code: result.exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
}
