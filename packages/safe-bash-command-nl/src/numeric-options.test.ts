import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createNlCommand } from "./index.js";

for (const option of ["-w", "-l", "-v", "-i"]) {
  for (const value of ["1", "+1", "-1", " 1", "\t+1", "\n\r\v\f1", "1 ", "1\t", " 1 ", "", " ", "+", "1x", "\u00a01"]) {
    test(`nl ${option} ${JSON.stringify(value)} follows GNU numeric syntax`, async () => {
      const valid = ["1", "+1", " 1", "\t+1", "\n\r\v\f1"].includes(value)
        || (value === "-1" && (option === "-v" || option === "-i"));
      const values = createCommandArguments(["-w1", option, value]);
      let stdout = "", stderr = "";
      const result = await createNlCommand().execute({
        command: "nl", args: values.args, argumentValues: values, cwd: "/", env: {},
        fs: createMemoryFileSystem(), stdin: toByteSource("A\nB\n"),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        signal: new AbortController().signal,
      });
      assert.equal(result.exitCode, valid ? 0 : 1, stderr);
      assert.equal(stdout, !valid ? "" : value !== "-1" ? "1\tA\n2\tB\n"
        : option === "-v" ? "-1\tA\n0\tB\n" : "1\tA\n0\tB\n");
      assert.equal(stderr.length > 0, !valid);
    });
  }
}
