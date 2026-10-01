import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, shellValueFromBytes, shellValueBytes, type CommandDefinition } from "safe-bash-contracts";
import { createFindCommand, createFindCommands, findCommands } from "./index.js";

async function run(command: CommandDefinition, args: string[], input = "") {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await command.execute({
    command: command.name, args: values.args, argumentValues: values, cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  return { ...result, stdout, stderr };
}

test("standalone find works with only portable filesystem and command contracts", async () => {
  assert.equal(createFindCommand().name, "find");
  assert.ok(createFindCommands().some(command => command.name === "find"));
  assert.equal(findCommands().name, "find-commands");
  const result = await run(createFindCommand(), [".", "-maxdepth", "0"], "");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, ".\n");
});

test("find omits non-tail tombstones in traversal, matching and count-only output", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/d");
  await fs.writeFile("/d/a", new Uint8Array());
  await fs.writeFile("/d/b", new Uint8Array());
  await fs.unlink("/d/a");
  for (const args of [["/d"], ["/d", "-type", "f"], ["/d", "-name", "*"], ["/d", "-iname", "*"]]) {
    for (const countOnly of [false, true]) {
      let stdout = "", stderr = "", count: number | undefined;
      const result = await createFindCommand().execute({
        ...{ _fastMemoryBackingFs: fs, _chargeFastFsOp() {} },
        command: "find", args, cwd: "/", env: {}, fs, stdin: toByteSource(""),
        stdout: {
          ...(countOnly ? { lineCountOnly: 0, writeLineCountSync(value: number) { count = value; return true; } } : {}),
          async write(bytes) { stdout += new TextDecoder().decode(bytes); },
        },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        signal: new AbortController().signal,
      });
      assert.equal(result.exitCode, 0, stderr);
      const expected = args[1] === "-type" ? "/d/b\n" : "/d\n/d/b\n";
      if (count !== undefined) assert.equal(count, 2);
      else assert.equal(stdout, expected);
    }
  }
});

test("find -exec preserves raw argument bytes through host invocation", async () => {
  const raw = new Uint8Array([0xff]);
  const values = createCommandArguments([".", "-maxdepth", "0", "-exec", "echo", shellValueFromBytes(raw), ";"]);
  let received: Uint8Array | undefined;
  const result = await createFindCommand().execute({
    command: "find", args: values.args, argumentValues: values, cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} },
    signal: new AbortController().signal,
    async invoke(_command, args, options) {
      received = shellValueBytes(options?.argumentValues?.values[0] ?? args[0]!);
      return { exitCode: 0 };
    },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(received, raw);
});
