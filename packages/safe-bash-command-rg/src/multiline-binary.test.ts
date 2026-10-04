import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createRgCommand } from "./index.js";

for (const recursive of [false, true]) {
  for (const [flags, output, exitCode] of [
    [[], recursive ? "" : 'binary file matches (found "\\0" byte around offset 7)\n', recursive ? 1 : 0],
    [["--binary"], `${recursive ? "/dir/bin.dat: " : ""}binary file matches (found "\\0" byte around offset 7)\n`, 0],
    [["--text"], `${recursive ? "/dir/bin.dat:" : ""}foo\n${recursive ? "/dir/bin.dat:" : ""}bar\n`, 0],
    [["--null-data"], `${recursive ? "/dir/bin.dat:" : ""}foo\nbar\0`, 0],
    [["--quiet"], "", recursive ? 1 : 0],
  ] as const) {
    test(`multiline only-matching honors binary policy: recursive=${recursive}, flags=${flags.join(" ")}`, async () => {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/dir");
      await fs.writeFile("/dir/bin.dat", new TextEncoder().encode("foo\nbar\0x\n"));
      const values = createCommandArguments(["-U", "-o", ...flags, "foo\\nbar", recursive ? "/dir" : "/dir/bin.dat"]);
      let stdout = "", stderr = "";
      const result = await createRgCommand().execute({
        command: "rg", args: values.args, argumentValues: values, cwd: "/", env: {},
        fs, stdin: toByteSource(""), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      });
      assert.equal(stderr, "");
      assert.equal(result.exitCode, exitCode);
      assert.equal(stdout, output);
    });
  }
}
