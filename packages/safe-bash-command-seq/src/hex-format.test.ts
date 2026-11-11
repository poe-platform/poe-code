import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource } from "safe-bash-contracts";
import { createSeqCommand } from "./index.js";

for (const { args, output } of [
 // GNU coreutils 9.4 on x86_64 Linux/glibc formats %a using the
 // x87 long-double ABI: a leading hexadecimal digit from 8 through f.
 { args: ["-f", "%.0a", "1.5", "1.5"], output: "0xcp-3\n" },
 { args: ["-f", "%.0A", "1.5", "1.5"], output: "0XCP-3\n" },
 { args: ["-f", "%a", "1", "1"], output: "0x8p-3\n" },
 { args: ["-f", "%.0a", "1.0625", "1.0625"], output: "0x8p-3\n" },
 { args: ["-f", "%.0a", "1.1875", "1.1875"], output: "0xap-3\n" },
 { args: ["-f", "%.0a", "1.9375", "1.9375"], output: "0x1p+1\n" },
 { args: ["-f", "%.1a", "1.5", "1.5"], output: "0xc.0p-3\n" },
 { args: ["-f", "%.0a", "-1.5", "-1.5"], output: "-0xcp-3\n" },
 { args: ["-f", "%a", "0", "0"], output: "0x0p+0\n" },
 { args: ["-f", "%a", "-0", "-0"], output: "-0x0p+0\n" },
]) {
 test(`seq GNU x86_64 hexadecimal format: ${args.join(" ")}`, async () => {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await createSeqCommand().execute({
   command: "seq", args: values.args, argumentValues: values, cwd: "/", env: {},
   fs: createMemoryFileSystem(), stdin: toByteSource(""),
   stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
   stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
   signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(stdout, output);
  assert.equal(stderr, "");
 });
}
