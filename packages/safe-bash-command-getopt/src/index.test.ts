import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createGetoptCommand, getoptCommands } from "./index.js";

for (const [options, expected] of [
  ["-o a:a -- -a x", " -a 'x' --"],
  ["-o aa: -- -a x", " -a -- 'x'"],
  ["-o '' -l 'x:,x' -- --x one", " --x 'one' --"],
  ["-o '' -l 'x,x:' -- --x one", " --x -- 'one'"],
] as const) {
  test(`getopt uses the first duplicate definition directly and in command substitution: ${options}`, async () => {
    const source: string = "../../safe-bash/src/index.js";
    const { Shell, standardCommands } = await import(source);
    const shell = new Shell({ fs: createMemoryFileSystem(), cwd: "/" }).use(standardCommands()).use(getoptCommands());
    try {
      for (const [script, stdout] of [
        [`getopt ${options}`, expected + "\n"],
        [`v=$(getopt ${options}); printf '%s' "$v"`, expected],
      ]) {
        const result = await shell.exec(script);
        assert.equal(result.exitCode, 0, script);
        assert.equal(result.stderr, "", script);
        assert.equal(result.stdout, stdout, script);
      }
    } finally {
      await shell.dispose();
    }
  });
}

test("getopt help works through the standalone portable factory", async () => {
 const values = createCommandArguments(["--help"]);
 let output = "";
 const result = await createGetoptCommand().execute({
  command: "getopt", args: values.args, argumentValues: values, cwd: "/", env: {},
  fs: createMemoryFileSystem(), stdin: toByteSource(""),
  stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  stderr: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
  signal: new AbortController().signal,
 });
 assert.equal(result.exitCode, 0, output);
 assert.ok(output.length > 0);
});
