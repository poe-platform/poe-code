import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { runWithBytes, chunks, run } from "./helpers.js";
import { Shell, agentCommands } from "../../../src/core.js";

test("jq -S reads virtual files and writes exact sorted pretty JSON through Shell", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input", Buffer.from('{"z":1,"a":2}\n'));
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    const result = await shell.exec("jq -S . input");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, new Uint8Array(Buffer.from('{\n  "a": 2,\n  "z": 1\n}\n')));
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

for (const flags of [["-Sc"], ["-cS"], ["--sort-keys", "--compact-output"]]) {
  test(`jq recursively sorts Unicode, numeric and prototype keys with ${flags.join(" ")}`, async () => {
    const input = '{"z":{"2":2,"10":10,"a":1},"a":[{"😀":1,"\uE000":2,"é":3,"A":4}],"__proto__":5,"constructor":6}';
    const result = await runWithBytes([...flags, "."], chunks(input));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, Buffer.from('{"__proto__":5,"a":[{"A":4,"é":3,"\uE000":2,"😀":1}],"constructor":6,"z":{"10":10,"2":2,"a":1}}\n'));
    assert.equal(result.stderr, "");
  });
}

test("jq -S changes output ordering without mutating filter values or tojson strings", async () => {
  const result = await run(["-Sc", ".,keys_unsorted,.,tojson"], '{"z":1,"a":2}');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, '{"a":2,"z":1}\n["z","a"]\n{"a":2,"z":1}\n"{\\"z\\":1,\\"a\\":2}"\n');
  assert.equal((await run(["-c", "."], '{"z":1,"a":2}')).stdout, '{"z":1,"a":2}\n');
});

test("jq -S preserves decimal values, raw strings, join output and exit status", async () => {
  const result = await run(["-Scej", "."], '{"z":12.3400,"a":9007199254740993123456789}\n"raw"\nnull');
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, '{"a":9007199254740993123456789,"z":12.3400}rawnull');
});

test("jq -S retains exact output byte limits", async () => {
  const args = ["-Sc", "."];
  const input = '{"z":1,"a":2}';
  assert.equal((await run(args, input, { limits: { maxOutputBytes: 14 } })).stdout, '{"a":2,"z":1}\n');
  const rejected = await run(args, input, { limits: { maxOutputBytes: 13 } });
  assert.equal(rejected.exitCode, 5);
  assert.equal(rejected.stdout, "");
  assert.equal(rejected.stderr, "jq: maxOutputBytes limit exceeded\n");
});

test("jq -S charges sorting to the shared work budget", async () => {
  const input = JSON.stringify(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`key${20 - i}`, i])));
  const options = { limits: { maxSteps: 1000 } };
  assert.equal((await run(["-c", "."], input, options)).exitCode, 0);
  const sorted = await run(["-Sc", "."], input, options);
  assert.equal(sorted.exitCode, 5);
  assert.equal(sorted.stdout, "");
  assert.equal(sorted.stderr, "jq: maxSteps limit exceeded\n");
});

