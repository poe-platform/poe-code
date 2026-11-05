import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { buffer } from "node:stream/consumers";
import test from "node:test";
import { RustWasmBash } from "@poe-code/safe-bash-rust";
import { SafeBashE2EHarness, sb } from "./harness.js";

test("Linux command pipe results match in TypeScript and Rust", async t => {
  const env = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };
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
      ["sha512sum"], ["sha384sum"], ["sha256sum"], ["sha1sum"], ["md5sum"], ["cksum"],
      ["basename", "/a/b"], ["dirname", "/a/b"], ["seq", "1", "4"], ["factor", "140"],
      ["expr", "7", "+", "4"], ["numfmt", "--to=iec", "1024"], ["tee"], ["true"], ["false"],
      ["printf", "%04d", "7"], ["echo", "alpha", "beta"],
    ] as const) {
      await t.test(cmd, async () => {
        const proc = spawn("/usr/bin/" + cmd, args, { env });
        const finished = once(proc, "close");
        proc.stdin.on("error", (error: NodeJS.ErrnoException) => {
          if (error.code !== "EPIPE") throw error;
        });
        proc.stdin.end(input);
        const [[code], stdout, stderr] = await Promise.all([finished, buffer(proc.stdout), buffer(proc.stderr)]);
        const script = [cmd, ...args.map(arg => "'" + arg + "'")].join(" ");
        for (const shell of [ts.shell, rust]) {
          const result = await shell.exec(script, { stdin: input });
          assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], [code, stdout, stderr]);
        }
      });
    }
  } finally {
    await ts.dispose();
    await rust.dispose();
  }
});
