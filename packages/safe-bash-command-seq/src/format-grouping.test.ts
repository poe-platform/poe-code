import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSeqCommand } from "./index.js";

// Expected output from GNU coreutils 9.4 with C and en_US.utf8 locales.
const cases: { format: string; operands?: string[]; env: Record<string, string>; output: string; maxRecordBytes?: number }[] = [
  { format: "%'.0f", env: { LC_ALL: "C" }, output: "9999\n10000\n" },
  { format: "%'.0f", env: { LC_ALL: "C.utf8" }, output: "9999\n10000\n" },
  { format: "%'.0f", env: { LC_ALL: "POSIX" }, output: "9999\n10000\n" },
  { format: "%'.0f", env: {}, output: "9999\n10000\n" },
  { format: "%'.0f", env: { LC_ALL: "en_US.utf8" }, output: "9,999\n10,000\n" },
  { format: "%'.0f", env: { LC_NUMERIC: "en_US.UTF-8", LANG: "C" }, output: "9,999\n10,000\n" },
  { format: "%'.0f", env: { LC_ALL: "", LC_NUMERIC: "", LANG: "en_US.utf8" }, output: "9,999\n10,000\n" },
  { format: "%'.0f", env: { LC_ALL: "C", LC_NUMERIC: "en_US.utf8", LANG: "en_US.utf8" }, output: "9999\n10000\n" },
  { format: "%'.0f", env: { LC_NUMERIC: "C", LANG: "en_US.utf8" }, output: "9999\n10000\n" },
  { format: "%.0f", env: { LC_ALL: "en_US.utf8" }, output: "9999\n10000\n" },
  { format: "%'+012.2f", env: { LC_ALL: "en_US.utf8" }, output: "+0009,999.00\n+0010,000.00\n" },
  { format: "%'-12.0f", env: { LC_ALL: "en_US.utf8" }, output: "9,999       \n10,000      \n" },
  { format: "%'.0f", operands: ["-10000", "-9999"], env: { LC_ALL: "en_US.utf8" }, output: "-10,000\n-9,999\n" },
  { format: "%'.1f", operands: ["9999.8", "0.1", "10000"], env: { LC_ALL: "en_US.utf8" }, output: "9,999.8\n9,999.9\n10,000.0\n" },
  { format: "%'.1f", operands: ["1000", "0.1", "1000.3"], env: { LC_ALL: "en_US.utf8" }, output: "1,000.0\n1,000.1\n1,000.2\n1,000.3\n" },
  { format: "[%'#.0f]", env: { LC_ALL: "en_US.utf8" }, output: "[9,999.]\n[10,000.]\n" },
  { format: "%''g", env: { LC_ALL: "en_US.utf8" }, output: "9,999\n10,000\n" },
  { format: "%'G", operands: ["999999", "1000000"], env: { LC_ALL: "en_US.utf8" }, output: "999,999\n1E+06\n" },
  { format: "%'e", env: { LC_ALL: "en_US.utf8" }, output: "9.999000e+03\n1.000000e+04\n" },
  { format: "%'a", operands: ["0", "0"], env: { LC_ALL: "en_US.utf8" }, output: "0x0p+0\n" },
  { format: "%'.0f", operands: ["999999.5", "999999.5"], env: { LC_ALL: "en_US.utf8" }, output: "1,000,000\n" },
  { format: "%'.0f", operands: ["10000", "10000"], env: { LC_ALL: "en_US.utf8" }, output: "", maxRecordBytes: 5 },
];

for (const { format, operands = ["9999", "10000"], env, output, maxRecordBytes } of cases) {
  for (const maxChunkBytes of [Infinity, 3]) {
    test(`seq grouping ${JSON.stringify({ format, operands, env, maxChunkBytes, maxRecordBytes })}`, async () => {
      const values = createCommandArguments(["-f", format, ...operands]);
      let stdout = "", stderr = "";
      const result = await createSeqCommand({ limits: { maxChunkBytes, maxRecordBytes: maxRecordBytes ?? Infinity } }).execute({
        command: "seq", args: values.args, argumentValues: values, cwd: "/", env,
        fs: createMemoryFileSystem(), stdin: toByteSource(""),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        signal: new AbortController().signal,
      });
      assert.equal(result.exitCode, maxRecordBytes ? 1 : 0, stderr);
      assert.equal(stdout, output);
      if (maxRecordBytes) assert.ok(stderr.includes("record limit exceeded"), stderr);
      else assert.equal(stderr, "");
    });
  }
}
