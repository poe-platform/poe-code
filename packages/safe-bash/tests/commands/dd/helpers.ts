import { createMemoryFileSystem, toByteSource } from "poe-code/safe-fs";
import type { CommandContext } from "../../../src/contracts/command.js";
import { createDdCommand, type DdCommandsOptions } from "../../../src/commands/dd/index.js";

export async function run(args: readonly string[], input: Uint8Array = new Uint8Array(),
  overrides: Partial<CommandContext> = {}, options: DdCommandsOptions = {}) {
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "dd", args, cwd: "/", env: { LC_ALL: "C" }, fs: createMemoryFileSystem(),
    stdin: toByteSource(input), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes) { stderr.push(new Uint8Array(bytes)); } },
    ...overrides,
  };
  const result = await createDdCommand(options).execute(context);
  return { exitCode: result.exitCode, stdout: new Uint8Array(Buffer.concat(stdout)), stderr: Buffer.concat(stderr).toString() };
}

export const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
