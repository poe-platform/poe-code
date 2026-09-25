import { strict as assert } from "node:assert";
import {
  toByteSource, type ByteSource, type CommandContext,
} from "safe-bash-contracts";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createXzCommands } from "./command.js";

export const binary = Uint8Array.from({ length: 256 }, (_, index) => index);
export const emptyMember = Buffer.from("1f8b080000000000000303000000000000000000", "hex");
export const helloMember = Buffer.from("1f8b0800000000000003cb48cdc9c9e7020020303a3606000000", "hex");

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
  const definition = createXzCommands().find((entry) => entry.name === command);
  assert.ok(definition);
  const result = await definition.execute(context);
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString(), fs: context.fs };
}
