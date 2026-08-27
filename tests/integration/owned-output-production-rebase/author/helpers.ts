import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { CommandRegistry, type ByteSink } from "../../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell, type ShellOptions } from "../../../../src/shell/index.js";
import { streamCommands } from "../../../../src/commands/streams.js";

export function deferred<Value = void>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

export const turn = () => setImmediate();
export const bytes = (value: string) => new TextEncoder().encode(value);
export const discard: ByteSink = { async write() {} };

export function fixture(options: Partial<ShellOptions> = {}) {
  const fs = new MemoryFileSystem();
  const commands = new CommandRegistry(streamCommands());
  return { fs, commands, shell: new Shell({ fs, commands, ...options }) };
}

export async function remainsPending(pending: Promise<unknown>): Promise<void> {
  let settled = false;
  void pending.then(() => { settled = true; }, () => { settled = true; });
  await turn();
  assert.equal(settled, false, "cooperative work must delay settlement");
}
