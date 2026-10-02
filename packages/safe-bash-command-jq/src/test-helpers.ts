import { createJqCommand } from "./index.js";
import type { StructuredCommandsOptions } from "safe-bash-query-engine/limits";
import { toByteSource, type ByteSource, type CommandContext } from "safe-bash-contracts";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";

export async function run(args: readonly string[], input: string | Uint8Array | ByteSource = "null", options: StructuredCommandsOptions = {}, overrides: Partial<CommandContext> = {}) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "jq", args, stdin: typeof input === "string" || input instanceof Uint8Array ? toByteSource(input) : input,
    stdout: { async write(chunk) { stdout.push(Buffer.from(chunk)); } },
    stderr: { async write(chunk) { stderr.push(Buffer.from(chunk)); } },
    cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: new AbortController().signal, ...overrides,
  };
  const result = await createJqCommand(options).execute(context);
  const stdoutBytes = Buffer.concat(stdout);
  const stderrBytes = Buffer.concat(stderr);
  return { ...result, stdout: stdoutBytes.toString(), stderr: stderrBytes.toString(), context };
}
export interface Case { input: string; filter: string; output: string; status?: number; flags?: string[] }
export function row(input: string, filter: string, values: unknown[], status = 0, flags: string[] = []): Case {
  return { input, filter, output: values.map(value => `${JSON.stringify(value)}\n`).join(""), status, flags };
}
