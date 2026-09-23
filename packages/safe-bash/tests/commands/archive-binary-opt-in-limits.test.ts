import assert from "node:assert/strict";
import test from "node:test";
import { settings as archive } from "../../src/commands/archive/internal.js";
import { settings as split } from "../../src/commands/split/options.js";
import { settings as hexdump } from "../../src/commands/hexdump/internal.js";
import { settings as lineEndings } from "../../src/commands/line-endings/internal.js";
import { settings as iconv } from "../../src/commands/iconv/internal.js";
import { settings as applyPatch } from "../../src/commands/apply-patch/options.js";
import { limitsFor as cmp } from "../../src/commands/cmp/options.js";
import { settings as shuf } from "../../src/commands/shuf/options.js";

for (const [family, resolve] of [
  ["archive", archive], ["split", split], ["hexdump", hexdump],
  ["line-endings", lineEndings], ["iconv", iconv], ["apply-patch", applyPatch], ["cmp", cmp],
] as const) {
  test(`${family}: omitted quotas are unlimited and explicit quotas are independent`, () => {
    const omitted = resolve({});
    for (const [name, value] of Object.entries(omitted)) {
      if (name === "chunkSize" || name === "maxChunkBytes") continue;
      assert.equal(value, Infinity, name);
      for (const maximum of [64, Number.MAX_SAFE_INTEGER]) {
        const limited = resolve({ limits: { [name]: maximum } });
        assert.equal(Reflect.get(limited, name), maximum);
        for (const [other, budget] of Object.entries(limited)) {
          if (other !== name) assert.equal(budget, Reflect.get(omitted, other), other);
        }
      }
      for (const invalid of [0, -1, NaN, Infinity, 1.5]) {
        assert.throws(() => resolve({ limits: { [name]: invalid } }));
      }
    }
  });
}

test("shuf: sample and input quotas are independent", () => {
  assert.deepEqual(shuf({}), { maxInputBytes: Infinity, maxSampleSize: Infinity });
  assert.deepEqual(shuf({ maxSampleSize: 2 }), { maxInputBytes: Infinity, maxSampleSize: 2 });
  assert.deepEqual(shuf({ maxInputBytes: Number.MAX_SAFE_INTEGER }), { maxInputBytes: Number.MAX_SAFE_INTEGER, maxSampleSize: Infinity });
  assert.throws(() => shuf({ maxInputBytes: Infinity }), RangeError);
});

import { createArchiveCommands } from "../../src/commands/archive/index.js";
import { createSplitCommands } from "../../src/commands/split/index.js";
import { createIconvCommand } from "../../src/commands/iconv/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { toByteSource, type CommandDefinition } from "../../src/contracts/index.js";

async function execute(command: CommandDefinition, args: string[], input = "", fallback = false) {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from(input));
  const fs = fallback ? new Proxy(memory, { get(target, key) {
    if (key === "readStream") return undefined;
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } }) : memory;
  const output: Uint8Array[] = [], errors: Uint8Array[] = [];
  const result = await command.execute({ command: command.name, args, cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: toByteSource(input),
    stdout: { async write(bytes) { output.push(Uint8Array.from(bytes)); } },
    stderr: { async write(bytes) { errors.push(Uint8Array.from(bytes)); } },
  });
  return { ...result, stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString(), fs: memory };
}

test("archive retained reads avoid buffering with an independent member limit", async () => {
  const input = "a".repeat(1024 * 1024 + 1);
  for (const limits of [undefined, { maxMembers: 8 }]) {
    const command = createArchiveCommands(limits ? { limits } : {}).find(command => command.name === "tar")!;
    const result = await execute(command, ["-cf", "/result.tar", "input"], input, true);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok((await result.fs.stat("/result.tar")).size > input.length);
  }
  const command = createArchiveCommands({ limits: { maxBufferedFileBytes: 1024 * 1024 } }).find(command => command.name === "tar")!;
  const result = await execute(command, ["-cf", "/result.tar", "input"], input, true);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok((await result.fs.stat("/result.tar")).size > input.length);
  const limited = createArchiveCommands({ limits: { maxEntryBytes: 1024 * 1024 } }).find(command => command.name === "tar")!;
  assert.equal((await execute(limited, ["-cf", "/result.tar", "input"], input, true)).exitCode, 2);
});

test("split permits suffixes beyond the old quota and honors an explicit suffix limit", async () => {
  const result = await execute(createSplitCommands()[0]!, ["-a", "129", "-b", "1", "-", "part"], "a");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await result.fs.readdir("/")).some(name => name.name.length === 133), true);
  const limited = await execute(createSplitCommands({ limits: { maxSuffixLength: 128 } })[0]!, ["-a", "129", "-b", "1"], "a");
  assert.equal(limited.exitCode, 1);
});

test("iconv fallback reads preserve omitted and explicit input limits", async () => {
  for (const limits of [undefined, { maxOutputBytes: 64 }]) {
    const result = await execute(createIconvCommand(limits ? { limits } : {}), ["-f", "UTF-8", "-t", "UTF-8", "/input"], "abc", true);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "abc");
  }
  const result = await execute(createIconvCommand({ limits: { maxInputBytes: 2 } }), ["-f", "UTF-8", "-t", "UTF-8", "/input"], "abc", true);
  assert.equal(result.exitCode, 1);
});

import { createShufCommand } from "../../src/commands/shuf/index.js";
import { createHexdumpCommand } from "../../src/commands/hexdump/index.js";
import { createDos2unixCommand } from "../../src/commands/line-endings/index.js";

test("shuf range mode accepts omitted sample quota and enforces an individual sample quota", async () => {
  const result = await execute(createShufCommand(), ["-i", "1-1"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "1\n");
  const limited = await execute(createShufCommand({ maxSampleSize: 1 }), ["-i", "1-2"]);
  assert.equal(limited.exitCode, 1);
  assert.match(limited.stderr, /maxSampleSize/);
});

for (const [family, create, args, expected] of [
  ["hexdump", createHexdumpCommand, ["-C", "/input"], "00000000"],
  ["line endings", createDos2unixCommand, ["-O", "/input"], "abc\n"],
] as const) {
  test(`${family}: fallback buffer accounting supports unlimited quotas`, async () => {
    const result = await execute(create(), [...args], "abc\r\n", true);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes(expected));
  });
}
