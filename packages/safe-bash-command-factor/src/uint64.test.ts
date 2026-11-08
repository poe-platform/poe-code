import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createFactorCommand } from "./index.js";

for (const stdin of [false, true]) for (const [input, expected] of [
  ["4294967296", "2^32"],
  ["12157665459056928801", "3^40"],
  ["3825123056546413051", "149491 747451 34233211"],
  ["18446744073709551615", "3 5 17 257 641 65537 6700417"],
  ["18446744073709551557", "18446744073709551557"],
  ["18446743979220271189", "4294967279 4294967291"],
  ["18446744030759878681", "4294967291^2"],
] as const) test(`factor uint64 ${input} within bounded work, stdin=${stdin}`, async () => {
  const values = createCommandArguments(stdin ? ["-h"] : ["-h", input]);
  let stdout = "", stderr = "";
  const result = await createFactorCommand({ limits: { maxWork: 5_000_000, maxValue: stdin ? 18446744073709551615n : undefined } }).execute({
    command: "factor", args: values.args, argumentValues: values, cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(stdin ? input : ""), signal: new AbortController().signal,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
  });
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stdout, `${input}: ${expected}\n`);
});

for (const mode of ["work", "buffer", "abort"] as const) test(`uint64 splitting respects ${mode}`, async () => {
  const controller = new AbortController();
  const values = createCommandArguments(["18446743979220271189"]);
  let stdout = "", stderr = "";
  const timer = mode === "abort" ? setImmediate(() => controller.abort(new Error("cancelled"))) : undefined;
  try {
    const execution = createFactorCommand({ limits: {
      maxWork: mode === "work" ? 2000 : undefined,
      maxBufferedBytes: mode === "buffer" ? 2048 : undefined,
    } }).execute({
      command: "factor", args: values.args, argumentValues: values, cwd: "/", env: {},
      fs: createMemoryFileSystem(), stdin: toByteSource(""), signal: controller.signal,
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    if (mode === "abort") await assert.rejects(Promise.resolve(execution), /cancelled/);
    else {
      assert.equal((await execution).exitCode, 1);
      assert.match(stderr, mode === "work" ? /work limit exceeded/ : /buffered bytes limit exceeded/);
    }
    assert.equal(stdout, "");
  } finally { if (timer) clearImmediate(timer); }
});
