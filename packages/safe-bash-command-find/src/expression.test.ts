import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { createDirectoryReader } from "safe-bash-io-engine/commands/directory-admission";
import { compileFindExpression } from "./expression.js";

test("expression compilation preserves lazy boolean actions independently of traversal", async () => {
  const calls: string[][] = [];
  const fs = createMemoryFileSystem();
  const context: CommandContext = {
    command: "find", args: [".", "-false", "-a", "-exec", "probe", "skipped", ";", "-o", "-exec", "probe", "{}", ";"],
    cwd: "/", env: {}, fs, stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} },
  };
  const expression = await compileFindExpression(context, async child => {
    calls.push([...child.args]);
    return { exitCode: 0 };
  }, createDirectoryReader());
  assert.deepEqual(calls, []);
  assert.deepEqual(expression.roots, ["."]);
  assert.equal(await expression.evaluate({ path: "/", display: ".", root: ".", relative: "", depth: 0,
    stat: await fs.stat("/"), name: ".", symlink: false, prune: false }), true);
  assert.deepEqual(calls, [["."]]);
});
