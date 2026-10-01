import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createFactorCommand } from "./index.js";

test("factor help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createFactorCommand().execute({
  command: "factor", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});

for (const owned of [false, true]) {
 test(`factor preserves distinct retained records, ownedOutput=${owned}`, async () => {
  const numbers = Array.from({ length: 1500 }, (_, index) => index + 10000);
  const expected = numbers.map(number => {
   let remaining = number;
   const factors: number[] = [];
   for (let divisor = 2; divisor * divisor <= remaining; divisor++) {
    while (remaining % divisor === 0) { factors.push(divisor); remaining /= divisor; }
   }
   if (remaining > 1) factors.push(remaining);
   return `${number}: ${factors.join(" ")}\n`;
  }).join("");
  const chunks: Uint8Array[] = [];
  const sink = { async write(bytes: Uint8Array) { chunks.push(bytes); } };
  const values = createCommandArguments([]);
  const result = await createFactorCommand().execute({
   command: "factor", args: values.args, argumentValues: values, cwd: "/", env: {},
   fs: createMemoryFileSystem(), stdin: toByteSource(numbers.join(" ")),
   stdout: owned ? { async write() { assert.fail("expected owned output"); }, ownedOutput: { ...sink, consumerClosed: new AbortController().signal } } : sink,
   stderr: { async write() { assert.fail("unexpected diagnostic"); } },
   signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 0);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.map(chunk => new TextDecoder().decode(chunk)).join(""), expected);
 });
}
