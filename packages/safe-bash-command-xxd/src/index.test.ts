import assert from "node:assert/strict";
import test from "node:test";
import { createXxdCommand, createXxdCommands, xxdCommands } from "./index.js";

test("xxd command definition exports standard contract", () => {
  const def = createXxdCommand();
  assert.equal(def.name, "xxd");
  assert.equal(typeof def.execute, "function");
  assert.equal(createXxdCommands().length, 1);
  assert.equal(xxdCommands().name, "xxd-commands");
});

import { createMemoryFileSystem, createOverlayFileSystem, type FileSystem } from "@poe-code/safe-fs";
import { collectText, createBytePipe, createCommandArguments } from "safe-bash-contracts";

async function run(args: string[], fs: FileSystem, maxInputBytes = 1024) {
  const stdout = createBytePipe();
  const stderr = createBytePipe();
  const result = await createXxdCommand({ limits: { maxInputBytes } }).execute({
    command: "xxd", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), stdout: stdout.writable, stderr: stderr.writable,
    signal: new AbortController().signal,
  });
  await stdout.close();
  await stderr.close();
  return { ...result, stdout: await collectText(stdout.readable, {}), stderr: await collectText(stderr.readable, {}) };
}

test("xxd accepts Infinity through nested and legacy limit options", () => {
  assert.doesNotThrow(() => createXxdCommand({ limits: { maxInputBytes: Infinity } }));
  assert.doesNotThrow(() => xxdCommands({ maxInputBytes: Infinity }));
});

for (const streamingRead of [undefined, false]) {
  test(`xxd reads overlay files with streamingRead=${streamingRead} and enforces limits`, async () => {
    const lower = createMemoryFileSystem();
    await lower.writeFile("/16", new TextEncoder().encode("hello\0"));
    let fs: FileSystem = createOverlayFileSystem({ lower, upper: createMemoryFileSystem() });
    {
      const overlay = fs;
      fs = new Proxy({} as FileSystem, { get(_target, property) {
        if (property === "capabilities" && streamingRead === false) return { streamingRead: false };
        if (property === "readStream") return streamingRead === false ? () => { throw new Error("must use readFile"); } : undefined;
        const value = Reflect.get(overlay, property);
        return typeof value === "function" ? value.bind(overlay) : value;
      } });
    }
    const result = await run(["16"], fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.length > 0);
    const limited = await run(["16"], fs, 2);
    assert.notEqual(limited.exitCode, 0);
    assert.ok(limited.stderr.includes("input limit"));
  });
}

for (const value of [-1, NaN, -Infinity, 1.5]) {
  test(`xxd rejects invalid limit ${value}`, () => {
    assert.throws(() => createXxdCommand({ limits: { maxInputBytes: value } }), RangeError);
  });
}
