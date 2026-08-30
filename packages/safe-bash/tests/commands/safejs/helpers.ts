import assert from "node:assert/strict";
import { toByteSource, type ByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createSafeJsCommands } from "../../../src/commands/safejs/index.js";
import type { SafeJsCommandsOptions, SafeJsRunOptions, SafeJsRuntime } from "../../../src/commands/safejs/types.js";

export function contractRuntime(run: (source: string, options: SafeJsRunOptions<object>) => Promise<unknown>): SafeJsRuntime<object> {
  return {
    async run(source, options) { return { ok: true, returnValue: await run(source, options) }; },
    createBudget(options) { return { ...options }; },
    makeFsModule() { return {}; },
    declareHostOperation(operation) { return operation; },
  };
}

export async function execute<Budget>(args: readonly string[], options: SafeJsCommandsOptions<Budget> = {}, input: string | Uint8Array | ByteSource = "", overrides: Partial<CommandContext> = {}) {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const context: CommandContext = {
    command: "safejs", args, fs, cwd: "/work", env: { KEY: "virtual", LC_ALL: "C" },
    signal: new AbortController().signal,
    stdin: typeof input === "string" || input instanceof Uint8Array ? toByteSource(input) : input,
    stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
    ...overrides,
  };
  const definition = createSafeJsCommands(options)[0];
  assert(definition);
  const result = await definition.execute(context);
  return { ...result, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString(), context };
}

export function operation(options: SafeJsRunOptions<object>, module: string, name: string): (...args: unknown[]) => unknown {
  const value = options.modules[module]?.[name];
  assert.equal(typeof value, "function", `${module}.${name}`);
  return value as (...args: unknown[]) => unknown;
}

export function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}
