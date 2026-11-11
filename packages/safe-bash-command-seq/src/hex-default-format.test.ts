import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSeqCommand } from "./index.js";

// GNU coreutils 9.4, LC_ALL=C. Hex fractions and lowercase p select %g.
for (const [args, output] of [
  [["0x1p-32", "1", "1.1"], "2.32831e-10\n1\n"],
  [["0x1p20", "0x1p20"], "1.04858e+06\n"],
  [["0.001", "0x1p-10", "0.003"], "0.001\n0.00197656\n0.00295313\n"],
  [["0x1.8p0", "0x.8", "0x2.8"], "1.5\n2\n2.5\n"],
  [["1.00", "0x1.0", "3"], "1\n2\n3\n"],
  [["1.00", "1", "0x3p0"], "1\n2\n3\n"],
  [["1.00", "1", "0x3.0"], "1\n2\n3\n"],
  [["-w", "0x1p-32", "1", "1.1"], "2.32831e-10\n1\n"],
  [["-w", "1", "0x1p0", "10"], "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n"],
  [["-s", ":", "0x1p-1", "1", "2"], "0.5:1.5\n"],
  [["-0x1p20", "-0x1p20"], "-1.04858e+06\n"],
  [["0x1p0", "-0x1p-1", "0"], "1\n0.5\n0\n"],
  [["0x1p1", "0x1p0"], ""],
  [["-0x0p0", "0"], "-0\n"],
  [["0X1p20", "0X1p20"], "1.04858e+06\n"],
  [["0x1P20", "0x1P20"], "1048576\n"],
  [["0x100000", "0x100000"], "1048576\n"],
  [["1048576", "1048576"], "1048576\n"],
  [["1.00", "0x1", "0x3"], "1.00\n2.00\n3.00\n"],
  [["-f", "%.2f", "0x1p-1", "1", "2"], "0.50\n1.50\n"],
  [["-f", "%g", "0.001", "0x1p-10", "0.003"], "0.001\n0.00197656\n0.00295313\n"],
] as const) {
  for (const limits of [undefined, { maxChunkBytes: 7, maxSteps: 500 }]) {
    test(`seq hex default ${limits ? "chunked" : "batched"}: ${args.join(" ")}`, async () => {
      const values = createCommandArguments(args);
      let stdout = "", stderr = "";
      const result = await createSeqCommand(limits ? { limits } : {}).execute({
        command: "seq", args: values.args, argumentValues: values, cwd: "/", env: {},
        fs: createMemoryFileSystem(), stdin: toByteSource(""),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        signal: new AbortController().signal,
      });
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.equal(stdout, output);
    });
  }
}
