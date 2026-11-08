import assert from "node:assert/strict";
import test from "node:test";
import { chunks, run } from "./helpers.js";

for (const [label, env, args, level] of [
  ["no defaults", {}, ["-c"], 9],
  ["BZIP2", { BZIP2: "-1" }, ["-c"], 1],
  ["BZIP", { BZIP: "-2" }, ["-c"], 2],
  ["BZIP overrides BZIP2", { BZIP2: "-1", BZIP: "-2" }, ["-c"], 2],
  ["arguments override defaults", { BZIP2: "-1", BZIP: "-2" }, ["-3c"], 3],
  ["empty defaults", { BZIP2: "", BZIP: " \t\n" }, ["-c"], 9],
  ["whitespace-separated options", { BZIP2: " -1\t-2\n-3\r-4\v-5\f-6 -c " }, [], 6],
] as const) {
  test(`bzip2 environment: ${label}`, async () => {
    const input = Buffer.from("environment defaults\n");
    const encoded = await run("bzip2", args, chunks(input), { env });
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    assert.equal(encoded.stdout.subarray(0, 4).toString(), `BZh${level}`);
    const decoded = await run("bzip2", ["-dc"], chunks(encoded.stdout));
    assert.equal(decoded.exitCode, 0, decoded.stderr);
    assert.deepEqual(decoded.stdout, input);
  });
}

for (const command of ["bzip2", "bunzip2", "bzcat"]) {
  test(`${command} applies mode defaults from the virtual environment`, async () => {
    const result = await run(command, [], chunks(Buffer.from("payload\n")), {
      env: { BZIP2: "-z -c -1" },
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.subarray(0, 4).toString(), "BZh1");
  });
}

test("invalid environment options fail before consuming stdin", async () => {
  let read = false;
  async function* stdin() {
    read = true;
    yield Buffer.from("payload\n");
  }
  const result = await run("bzip2", ["-c"], stdin(), { env: { BZIP2: "--invalid" } });
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("--invalid"), result.stderr);
  assert.equal(result.stdout.length, 0);
  assert.equal(read, false);
});
