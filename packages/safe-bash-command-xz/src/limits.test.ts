import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { CommandRegistry, createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { createXzCommand, createXzCommands, xzCommands, type XzCommandsOptions, type XzLimits } from "./index.js";

test("xz validates configured limits and accepts unlimited defaults", () => {
  const limits: Partial<XzLimits> = { maxDecodedBytes: 0 };
  for (const create of [createXzCommand, createXzCommands, xzCommands]) {
    assert.doesNotThrow(() => create({ limits }));
    assert.doesNotThrow(() => create({ maxDecodedBytes: Infinity }));
    assert.doesNotThrow(() => create({ limits: { maxDecodedBytes: Infinity } }));
    for (const value of [-1, NaN, 1.5, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => create({ maxDecodedBytes: value }), RangeError);
      assert.throws(() => create({ limits: { maxDecodedBytes: value } }), RangeError);
    }
  }
});

// Native `xz -0c` output for the five bytes in "hello".
const helloXz = Buffer.from("/Td6WFoAAATm1rRGAgAhAQwAAACPmEGcAQAEaGVsbG8AAAAAsTe52+XaHpsAAR0FuC2Arx+2830BAAAAAARZWg==", "base64");

for (const registration of ["factory", "plugin"]) {
  for (const [label, options, exitCode] of [
    ["omitted options", undefined, 0],
    ["flat Infinity", { maxDecodedBytes: Infinity }, 0],
    ["nested Infinity", { limits: { maxDecodedBytes: Infinity } }, 0],
    ["exact decoded quota", { maxDecodedBytes: 5 }, 0],
    ["insufficient decoded quota", { maxDecodedBytes: 4 }, 1],
    ["zero decoded quota", { maxDecodedBytes: 0 }, 1],
  ] satisfies [string, XzCommandsOptions | undefined, number][]) {
    test(`xz ${registration} decodes through its registry with ${label}`, async () => {
      const commands = new CommandRegistry();
      if (registration === "factory") {
        for (const command of createXzCommands(options)) commands.register(command);
      } else {
        await xzCommands(options).setup({ commands, use() {}, registerFileSystem() {} });
      }
      assert.deepEqual(commands.list().map(command => command.name), ["xz", "unxz", "xzcat", "lzma", "unlzma", "lzcat"]);
      for (const name of ["xz", "unxz", "xzcat"]) {
        const command = commands.get(name);
        assert.ok(command);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const context: CommandContext = {
          command: name, ...createCommandArguments(["-dc"]), cwd: "/", env: {},
          fs: createMemoryFileSystem(), signal: new AbortController().signal,
          stdin: toByteSource(helloXz),
          stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        };
        assert.equal((await command.execute(context)).exitCode, exitCode, `${name}: ${stderr}`);
        if (exitCode === 0) {
          assert.equal(Buffer.concat(stdout).toString(), "hello");
          assert.equal(stderr, "");
        } else {
          assert.equal(Buffer.concat(stdout).length, 0);
          assert.ok(stderr.includes("decoded byte limit exceeded"), stderr);
        }
      }
    });
  }
}
