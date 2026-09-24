import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { agentCommands, createMemoryFileSystem, Shell } from "../../../src/index.js";
import { run } from "./helpers.js";

for (const input of [
  "[[1,2],[3,4]]\n", "[]\n", "[[],[1]]\n", "[[1],[]]\n",
  "[[null,true],[{\"a\":1},[2]]]\n", "[[1],{\"a\":2,\"b\":3}]\n",
  "null\n", "1\n", "\"abc\"\n", "{}\n", "{\"a\":[1]}\n",
  "[[1],2]\n", "[null]\n", "[[],2]\n", "[null,[]]\n",
  "[[1,2],[3]]\n[[4],[5,6]]\n",
]) test(`jq combinations native parity: ${input.trim()}`, async () => {
  const native = spawnSync("/usr/bin/jq", ["-c", "[combinations]"], { input, encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
  assert.ifError(native.error);
  assert.equal(native.signal, null);
  assert.notEqual(native.status, null);
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec("jq -c '[combinations]'", { stdin: input });
    assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
      { exitCode: native.status, stdout: native.stdout, stderr: native.stderr });
  } finally { await shell.dispose(); }
});

test("combinations streams a bounded prefix of an enormous product", async () => {
  const result = await run(["-c", "[limit(2; combinations)]"], JSON.stringify(Array.from({ length: 40 }, () => [0, 1])));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), [Array(40).fill(0), [...Array(39).fill(0), 1]]);
});

test("combinations cannot suppress resource failures", async () => {
  const result = await run(["-c", "combinations?"], "[[1],[2],[3]]\n", { limits: { maxCollectionSize: 2 } });
  assert.equal(result.exitCode, 5);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "jq: maxCollectionSize limit exceeded\n");
});
