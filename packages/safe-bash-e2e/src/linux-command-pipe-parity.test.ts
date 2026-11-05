import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { buffer } from "node:stream/consumers";
import test from "node:test";
import { RustWasmBash } from "@poe-code/safe-bash-rust";
import { SafeBashE2EHarness, sb } from "./harness.js";

const env = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };
async function native(cmd: string, args: readonly string[], input: string | Uint8Array) {
  const proc = spawn("/usr/bin/" + cmd, args, { env });
  const finished = once(proc, "close");
  proc.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
  });
  proc.stdin.end(input);
  const [[code], stdout, stderr] = await Promise.all([finished, buffer(proc.stdout), buffer(proc.stderr)]);
  return [code, stdout, stderr] as const;
}

test("Linux command pipe results match in TypeScript and Rust", async t => {
  const input = "alpha\nbeta\nbeta\n";
  const ts = await SafeBashE2EHarness.create({ env, fs: new sb.MemoryFileSystem() });
  const rust = new RustWasmBash({ env, forceNative: true });
  try {
    for (const [cmd, ...args] of [
      ["cat"], ["tac"], ["head", "-n", "2"], ["tail", "-n", "2"], ["wc", "-c"],
      ["sort"], ["uniq", "-c"], ["nl", "-ba"], ["cut", "-c", "1-2"], ["tr", "a-z", "A-Z"],
      ["fold", "-w", "3"], ["rev"], ["fmt", "-w", "20"], ["strings", "-n", "2"],
      ["expand"], ["unexpand"], ["paste", "-s"], ["grep", "beta"], ["sed", "s/beta/z/g"],
      ["awk", "END {print NR}"], ["base64"], ["base32"], ["xxd", "-p"], ["od", "-An", "-tx1"],
      ["sha512sum"], ["sha384sum"], ["sha256sum"], ["sha224sum"], ["sha1sum"], ["md5sum"], ["cksum"],
      ["basename", "/a/b"], ["dirname", "/a/b"], ["seq", "1", "4"], ["factor", "140"],
      ["expr", "7", "+", "4"], ["numfmt", "--to=iec", "1024"], ["tee"], ["true"], ["false"],
      ["printf", "%04d", "7"], ["echo", "alpha", "beta"], ["printenv", "LC_ALL"],
      ["dd", "bs=4", "count=2", "iflag=fullblock", "status=none"], ["shuf", "-i", "7-7"],
      ["date", "-u", "-d", "@0", "+%Y-%m-%d"], ["pr", "-t", "-n"], ["pathchk", "-p", "a/b"],
      ["iconv", "-f", "UTF-8", "-t", "UTF-16LE"], ["test", "3", "-gt", "2"], ["[", "x", "=", "y", "]"],
    ] as const) {
      await t.test(cmd, async () => {
        const [code, stdout, stderr] = await native(cmd,args,input);
        const script = [cmd, ...args.map(arg => "'" + arg + "'")].join(" ");
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
        const [status, packed, errors] = await native(compress, ["-c"], binary);
        assert.equal(status, 0, errors.toString());
        for (const shell of [ts.shell, rust]) {
          const written = await shell.exec(compress + " -c", {stdin: binary});
          assert.equal(written.exitCode, status, written.stderr);
          assert.deepEqual(Buffer.from(written.stderrBytes), errors);
          const [code, decoded, stderr] = await native(decompress, ["-c"], written.stdoutBytes);
          assert.equal(code, 0, stderr.toString());
          assert.deepEqual(decoded, binary);
          for (const cmd of [decompress, cat]) {
            const reference = await native(cmd, ["-c"], packed);
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
