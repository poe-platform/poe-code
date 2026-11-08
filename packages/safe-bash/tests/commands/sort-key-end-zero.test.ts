import assert from "node:assert/strict";
import test from "node:test";
import { textCommands } from "../../src/commands/text.js";
import { toByteSource, type CommandContext } from "../../src/contracts/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";

test("sort zero end-character includes the whole ending field", async () => {
  const sort = textCommands().find(command => command.name === "sort")!;
  for (const delimiter of ["\n", "\0"]) {
    for (const [mode, expected] of [
      ["-s", ["x|A1|z", "v|A9|a", "d|A9|q", "y|M9|b", "w|Q9|c"]],
      ["-u", ["x|A1|z", "v|A9|a", "y|M9|b", "w|Q9|c"]],
      ["-rs", ["w|Q9|c", "y|M9|b", "v|A9|a", "d|A9|q", "x|A1|z"]],
    ] as const) {
      for (const key of ["2,2.0", "2.1,2.0", "2,2"]) {
        const stdout: Uint8Array[] = [];
        const stderr: Uint8Array[] = [];
        const context: CommandContext = {
          command: "sort", args: [mode, ...(delimiter === "\0" ? ["-z"] : []), "-t", "|", "-k", key],
          cwd: "/", env: {}, fs: new MemoryFileSystem(), signal: new AbortController().signal,
          stdin: toByteSource(["w|Q9|c", "v|A9|a", "x|A1|z", "y|M9|b", "d|A9|q"].join(delimiter) + delimiter),
          stdout: { async write(bytes) { stdout.push(bytes.slice()); } },
          stderr: { async write(bytes) { stderr.push(bytes.slice()); } },
        };
        const result = await sort.execute(context);
        assert.equal(result.exitCode, 0, `${mode} ${key}`);
        assert.equal(Buffer.concat(stderr).toString(), "");
        assert.equal(Buffer.concat(stdout).toString(), expected.join(delimiter) + delimiter, `${mode} ${key}`);
      }
    }
  }
});

test("sort still rejects zero fields and zero starting characters", async () => {
  const sort = textCommands().find(command => command.name === "sort")!;
  for (const key of ["0,2.0", "2,0.0", "2.0,2.0"]) {
    const context: CommandContext = {
      command: "sort", args: ["-k", key], cwd: "/", env: {}, fs: new MemoryFileSystem(),
      signal: new AbortController().signal, stdin: toByteSource("b a\na b\n"),
      stdout: { async write() { assert.fail("invalid key must not publish output"); } },
      stderr: { async write() {} },
    };
    assert.equal((await sort.execute(context)).exitCode, 2, key);
  }
});
