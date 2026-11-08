import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createPrCommand } from "./index.js";

test("pr help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createPrCommand().execute({
  command: "pr", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});

for (const [width, missing, line] of [[40, ["/missing"], "abcdefghijklmnopqrstuvwxyz"], [2, ["/missing1", "/missing2"], "ab"]] as const) {
 test(`pr merge matches GNU 9.12 missing-file behavior at width ${width}`, async () => {
  const values = createCommandArguments(["-t", "-w", String(width), "-m", ...missing, "-"]);
  let stdout = "", stderr = "";
  const result = await createPrCommand().execute({
   command: "pr", args: values.args, argumentValues: values, cwd: "/", env: {},
   fs: createMemoryFileSystem(), stdin: toByteSource(line + "\n"),
   stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
   stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
   signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(stdout, width === 40 ? line.slice(0, 19) + "\n" : "");
  assert.ok(stderr.includes(width === 40 ? "/missing" : "page width too narrow"));
 });
}
