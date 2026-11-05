import assert from "node:assert/strict";
import test from "node:test";
import { RustWasmBash } from "@poe-code/safe-bash-rust";
import { SafeBashE2EHarness, sb } from "./harness.js";
import { linuxCommands, linuxEnv, runLinuxCommand } from "./linux-command-workloads.js";

test("Linux command pipe results match in TypeScript and Rust", async t => {
  const input = "alpha\nbeta\nbeta\n";
  const ts = await SafeBashE2EHarness.create({ env: linuxEnv, fs: new sb.MemoryFileSystem() });
  const rust = new RustWasmBash({ env: linuxEnv, forceNative: true });
  try {
    for (const { cmd, args, script } of linuxCommands) {
      await t.test(cmd, async () => {
        const [code, stdout, stderr] = await runLinuxCommand(cmd,args,input);
        for (const shell of [ts.shell, rust]) {
          const result = await shell.exec(script, { stdin: input });
          assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], [code, stdout, stderr]);
        }
      });
    }
    const binary = Buffer.alloc(32768);
    for (let i = 0; i < binary.length; i++) binary[i] = (i * 31 + (i >> 8)) % 256;
    for (const [compress, decompress, cat] of [
      ["gzip", "gunzip", "zcat"], ["bzip2", "bunzip2", "bzcat"], ["xz", "unxz", "xzcat"],
      ["lzma", "unlzma", "lzcat"], ["zstd", "unzstd", "zstdcat"],
    ] as const) {
      await t.test(compress + " streams decode in both directions", async () => {
        const [status, packed, errors] = await runLinuxCommand(compress, ["-c"], binary);
        assert.equal(status, 0, errors.toString());
        for (const shell of [ts.shell, rust]) {
          const written = await shell.exec(compress + " -c", {stdin: binary});
          assert.equal(written.exitCode, status, written.stderr);
          assert.deepEqual(Buffer.from(written.stderrBytes), errors);
          const [code, decoded, stderr] = await runLinuxCommand(decompress, ["-c"], written.stdoutBytes);
          assert.equal(code, 0, stderr.toString());
          assert.deepEqual(decoded, binary);
          for (const cmd of [decompress, cat]) {
            const reference = await runLinuxCommand(cmd, ["-c"], packed);
            const read = await shell.exec(cmd + " -c", {stdin: packed});
            assert.deepEqual([read.exitCode, Buffer.from(read.stdoutBytes), Buffer.from(read.stderrBytes)], reference, cmd);
          }
        }
      });
    }
  } finally {
    await ts.dispose();
    await rust.dispose();
  }
});
