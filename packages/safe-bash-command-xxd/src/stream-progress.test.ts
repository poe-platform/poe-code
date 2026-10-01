import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createXxdCommand } from "./index.js";

test("xxd flushes rows before requesting more input", async () => {
  let stdout = "", stderr = "";
  const observed: string[] = [];
  const result = await createXxdCommand().execute({
    command: "xxd", args: createCommandArguments([]).args,
    cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: (async function* () {
      for (const chunk of ["abcdefghijklmnop", "qrstuvwxyz012345"]) {
        yield new TextEncoder().encode(chunk);
        observed.push(stdout);
      }
      throw new Error("upstream failed");
    })(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  assert.notEqual(result.exitCode, 0);
  assert.notEqual(stderr, "");
  for (const [index, text] of ["00000000:", "00000010:"].entries()) {
    assert.ok(observed[index]?.includes(text), `missing ${text} before next input read`);
    assert.ok(stdout.includes(text), `lost ${text} after input failure`);
  }
});

test("xxd flushes plain rows before requesting more input", async () => {
  let stdout = "", stderr = "";
  const observed: string[] = [];
  const result = await createXxdCommand().execute({
    command: "xxd", args: createCommandArguments(["-p", "-c", "16"]).args,
    cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: (async function* () {
      for (const chunk of ["abcdefghijklmnop", "qrstuvwxyz012345"]) {
        yield new TextEncoder().encode(chunk);
        observed.push(stdout);
      }
      throw new Error("upstream failed");
    })(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  assert.notEqual(result.exitCode, 0);
  assert.notEqual(stderr, "");
  for (const [index, text] of ["61626364", "71727374"].entries()) {
    assert.ok(observed[index]?.includes(text), `missing ${text} before next input read`);
    assert.ok(stdout.includes(text), `lost ${text} after input failure`);
  }
});

test("xxd flushes reverse rows before requesting more input", async () => {
  let stdout = "", stderr = "";
  const observed: string[] = [];
  const result = await createXxdCommand().execute({
    command: "xxd", args: createCommandArguments(["-r"]).args,
    cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: (async function* () {
      for (const chunk of ["00000000: 6162\n", "00000002: 6364\n"]) {
        yield new TextEncoder().encode(chunk);
        observed.push(stdout);
      }
      throw new Error("upstream failed");
    })(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  assert.notEqual(result.exitCode, 0);
  assert.notEqual(stderr, "");
  for (const [index, text] of ["ab", "cd"].entries()) {
    assert.ok(observed[index]?.includes(text), `missing ${text} before next input read`);
    assert.ok(stdout.includes(text), `lost ${text} after input failure`);
  }
});
