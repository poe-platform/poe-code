import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createWhichCommand } from "./index.js";

test("which behavior works through the standalone portable factory", async () => {
 const values = createCommandArguments(["demo"]);
 let output = "";
 const fs = createMemoryFileSystem();
 await fs.mkdir("/bin");
 await fs.writeFile("/bin/demo", new Uint8Array(), { mode: 0o755 });
 const result = await createWhichCommand().execute({
  command: "which", args: values.args, argumentValues: values, cwd: "/", env: { PATH: "/bin" },
  fs, stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.equal(output, "/bin/demo\n");
});
