import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createRgrepCommand } from "./index.js";

test("rgrep help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createRgrepCommand().execute({
  command: "rgrep", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});

test("rgrep enforces configured grep resource limits", async () => {
  let stderr = "";
  const result = await createRgrepCommand({ maxLineBytes: 3 }).execute({
    command: "rgrep", args: ["needle", "-"], cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource("needle\n"), stdinIsDefault: false,
    stdout: { async write() { assert.fail("over-limit line must not be printed"); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 2);
  assert.match(stderr, /limit/);
});
