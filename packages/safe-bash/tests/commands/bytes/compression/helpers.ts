import { strict as assert } from "node:assert";
import {
  toByteSource, type ByteSink, type ByteSource, type CommandContext, type FileSystem,
} from "../../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { createCompressionCommands } from "../../../../src/commands/bytes/compression/index.js";

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
  const definition = createCompressionCommands().find((entry) => entry.name === command);
  assert.ok(definition);
  const result = await definition.execute(context);
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString(), fs: context.fs };
}

export function wrap(fs: FileSystem, overrides: Partial<FileSystem>): FileSystem {
  return new Proxy(fs, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

export const discard: ByteSink = { async write() {} };
