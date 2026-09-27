import assert from "node:assert/strict";
import test from "node:test";
import { createBcCommand, settings } from "./index.js";

test("bc command definition exports standard contract", () => {
  const def = createBcCommand();
  assert.equal(def.name, "bc");
  assert.equal(typeof def.execute, "function");
});

test("bc resource quotas are optional with equivalent flat and nested options", () => {
  const defaults = settings();
  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    assert.equal(defaults[key], Infinity, key);
    for (const value of [Infinity, 16]) {
      assert.equal(settings({ [key]: value })[key], value);
      assert.equal(settings({ limits: { [key]: value } })[key], value);
    }
    for (const value of [-Infinity, NaN, -1, 0, 1.5]) assert.throws(() => settings({ [key]: value }), RangeError);
  }
});


test("bc evaluates exponents above the former implicit ceiling", async () => {
  const { createMemoryFileSystem } = await import("@poe-code/safe-fs");
  const { createBytePipe, createCommandArguments } = await import("safe-bash-contracts");
  const stdin = createBytePipe(), stdout = createBytePipe(), stderr = createBytePipe();
  await stdin.writable.write(new TextEncoder().encode("2^20000\nscale=5; 2^-10001\n"));
  await stdin.close();
  const result = await createBcCommand().execute({
    command: "bc", args: createCommandArguments([]).args, cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: stdin.readable,
    stdout: stdout.writable, stderr: stderr.writable, signal: new AbortController().signal,
  });
  await stdout.close();
  await stderr.close();
  const chunks: Uint8Array[] = [];
  for await (const chunk of stdout.readable) chunks.push(chunk);
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.concat(chunks).toString("utf8"), `${2n ** 20000n}\n0\n`);
});
