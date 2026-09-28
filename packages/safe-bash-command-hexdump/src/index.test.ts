import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createHexdumpCommand } from "./index.js";

test("hexdump behavior works through the standalone portable factory", async () => {
 const values = createCommandArguments(["-C"]);
 let output = "";
 const result = await createHexdumpCommand().execute({
  command: "hexdump", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource("hello"),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.includes("68 65 6c 6c 6f"), output);
});
