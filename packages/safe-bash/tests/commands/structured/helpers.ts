import { createStructuredCommands, type StructuredCommandsOptions } from "../../../src/commands/structured/index.js";
import { toByteSource, type ByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";

export async function runWithBytes(args: readonly string[], input: string | Uint8Array | ByteSource = "null", options: StructuredCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "jq", args, stdin: typeof input === "string" || input instanceof Uint8Array ? toByteSource(input) : input,
    stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
    stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
    cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: new AbortController().signal, ...overrides,
  };
  const result = await createStructuredCommands(options)[0]!.execute(context);
  const stdoutBytes = Buffer.concat(stdout);
  const stderrBytes = Buffer.concat(stderr);
  return { ...result, stdout: stdoutBytes.toString(), stderr: stderrBytes.toString(), context, stdoutBytes, stderrBytes };
}
export async function run(...args: Parameters<typeof runWithBytes>) {
  const { stdoutBytes: ignoredStdoutBytes, stderrBytes: ignoredStderrBytes, ...result } = await runWithBytes(...args);
  return result;
}

export async function* chunks(input: string | Uint8Array, size = 1): ByteSource {
  const bytes = typeof input === "string" ? Buffer.from(input) : input;
  for (let index = 0; index < bytes.length; index += size) yield bytes.slice(index, index + size);
}
export interface Case { input: string; filter: string; output: string; status?: number; flags?: string[] }
export function row(input: string, filter: string, values: unknown[], status = 0, flags: string[] = []): Case {
  return { input, filter, output: values.map(value => `${JSON.stringify(value)}\n`).join(""), status, flags };
}
