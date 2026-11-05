import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { run } from "./test-helpers.js";

for (const [input, output] of [
  ["1\n2\n3\n", "1\n2\n3\n"],
  ["[\n1\n]\n2\n", "3\n4\n"],
  ["1 2", "0\n0\n"],
  ["1\n2", "1\n1\n"],
]) {
  test(`input_line_number tracks parser position for ${JSON.stringify(input)}`, async () => {
    const result = await run(["-c", "input_line_number"], input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, output);
  });
}

test("input_line_number is zero before input is read", async () => {
  const result = await run(["-cn", "input_line_number"], "1\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "0\n");
});

test("input_line_number tracks multiline virtual files and resets between files", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/one.json", new TextEncoder().encode("[\n1\n]\n2\n"));
  await fs.writeFile("/two.json", new TextEncoder().encode("3\n"));
  const result = await run(["-c", "input_line_number", "/one.json", "/two.json"], "", {}, { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "3\n4\n1\n");
});

test("input_line_number follows inputs and slurping", async () => {
  const result = await run(["-cn", "input_line_number, (inputs | input_line_number), input_line_number"], "1\n2\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "0\n1\n2\n2\n");
  const slurp = await run(["-cs", "input_line_number"], "1\n2\n");
  assert.equal(slurp.exitCode, 0, slurp.stderr);
  assert.equal(slurp.stdout, "2\n");
});
