import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { agentCommands, createMemoryFileSystem, Shell } from "../../../src/index.js";
import { run } from "./helpers.js";

for (const input of [
  "[[1,2],[3]]\n", "[[1,2],[3,4]]\n", "[]\n", "[[],[]]\n",
  "[[],[1,2],null]\n", "[[null,true],[{\"a\":1},[2]]]\n",
  "{}\n", "{\"a\":[1,2],\"b\":[3]}\n", "null\n", "1\n", "\"abc\"\n",
  "[true]\n", "[1]\n", "[\"ab\"]\n", "[{},[1]]\n", "[[1],2]\n",
  "[null]\n", "[0]\n", "[[1]]\n[[2,3],[]]\n",
]) test(`jq transpose native parity: ${input.trim()}`, async () => {
  const native = spawnSync("jq", ["-c", "transpose"], { input, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
  assert.ifError(native.error);
  assert.equal(native.signal, null);
  assert.notEqual(native.status, null);
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec("jq -c 'transpose'", { stdin: input });
    assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
      { exitCode: native.status, stdout: native.stdout, stderr: native.stderr });
  } finally { await shell.dispose(); }
});

test("transpose bounds padded output and cannot suppress resource failures", async () => {
  const result = await run(["-c", "transpose?"], "[[1,2,3,4],[],[],[]]\n", { limits: { maxValueBytes: 40 } });
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "jq: maxValueBytes limit exceeded\n");
});
