import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSeqCommand } from "./index.js";

// GNU coreutils 9.4, LC_ALL=C.
for (const [format, reason] of [
  ["abc", "has no % directive"],
  ["", "has no % directive"],
  ["%%", "has no % directive"],
  ["%d", "has unknown %d directive"],
  ["%lf", "has unknown %l directive"],
  ["%5.2d", "has unknown %d directive"],
  ["%Ld", "has unknown %d directive"],
  ["%", "ends in %"],
  ["%5", "ends in %"],
  ["%.2", "ends in %"],
  ["%L", "ends in %"],
  ["%f %f", "has too many % directives"],
  ["%f %", "has too many % directives"],
  ["%f %d", "has too many % directives"],
  ["%Lf", ""],
  ["%% %Lf %%", ""],
] as const) {
  test(`seq format diagnostic: ${JSON.stringify(format)}`, async () => {
    const values = createCommandArguments(["-f", format, "1"]);
    let stdout = "", stderr = "";
    const result = await createSeqCommand().execute({
      command: "seq", args: values.args, argumentValues: values, cwd: "/", env: { LC_ALL: "C" },
      fs: createMemoryFileSystem(), stdin: toByteSource(""),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      signal: new AbortController().signal,
    });
    assert.equal(result.exitCode, reason ? 1 : 0);
    assert.equal(stdout, reason ? "" : format === "%Lf" ? "1.000000\n" : "% 1.000000 %\n");
    assert.equal(stderr, reason ? `seq: format '${format}' ${reason}\n` : "");
  });
}
