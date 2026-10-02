import assert from "node:assert/strict";
import { toByteSource, type ByteSource, type CommandContext } from "safe-bash-contracts";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createBzip2Commands } from "./index.js";

export async function* chunks(...values: Uint8Array[]): ByteSource { yield* values; }

export async function run(
  command: string, args: readonly string[] = [], stdin: ByteSource = toByteSource(""),
  overrides: Partial<CommandContext> = {},
) {
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command, args, stdin, cwd: "/", env: {}, fs: createMemoryFileSystem(),
    signal: new AbortController().signal,
    stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
    stderr: { async write(chunk) { stderr.push(chunk.slice()); } },
    ...overrides,
  };
  const definition = createBzip2Commands().find((entry) => entry.name === command);
  assert.ok(definition);
  const result = await definition.execute(context);
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString(), fs: context.fs };
}
