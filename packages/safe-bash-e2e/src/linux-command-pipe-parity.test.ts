import { rm } from "node:fs/promises";
import { gitCommands } from "@poe-platform/safe-bash/commands/git";
import assert from "node:assert/strict";
import test from "node:test";
import { RustWasmBash } from "@poe-code/safe-bash-rust";
import { SafeBashE2EHarness, sb } from "./harness.js";
import { codecInput, createLinuxCommandDirectory, linuxCodecs, linuxCommands, linuxEnv, runLinuxCommand, supportsHostPlugins } from "./linux-command-workloads.js";

test("Linux command pipe results match in TypeScript and Rust", async t => {
  const ts = await SafeBashE2EHarness.create({ env: linuxEnv, fs: new sb.MemoryFileSystem() });
  const rust = new RustWasmBash({ env: linuxEnv, cwd: "/workspace", forceNative: true });
  let cwd: string | undefined;
  try {
    cwd = await createLinuxCommandDirectory(ts.fs, rust.fs);
    for (const { cmd, args, script, input } of linuxCommands("alpha\nbeta\nbeta\n")) {
      await t.test(cmd, async t => {
        if (cmd === "git") {
          if (!supportsHostPlugins) return t.skip("The Git plugin needs WebAssembly Promise Integration");
          ts.shell.use(gitCommands());
          rust.use(gitCommands());
        }
        const [code, stdout, stderr] = await runLinuxCommand(cmd, args, input, cwd);
        for (const shell of [ts.shell, rust]) {
          const result = await shell.exec(script, { stdin: input });
          assert.deepEqual([result.exitCode, Buffer.from(result.stdoutBytes), Buffer.from(result.stderrBytes)], [code, stdout, stderr]);
        }
      });
    }
    await t.test("env preserves its listing order when passing entries to a child", async () => {
      const assignments = ["Z=first", "A=one", "M=", "Z=last"];
      const [code, listing, stderr] = await runLinuxCommand("env", ["-i", "-0", ...assignments], "");
      assert.equal(code, 0);
      assert.equal(stderr.length, 0);
      for (const command of ["env", "printenv"]) {
        const child = await runLinuxCommand("env", ["-i", ...assignments, command, "-0"], "");
        assert.deepEqual(child, [code, listing, stderr]);
      }
      for (const shell of [ts.shell, rust]) {
        const prefix = "env -i " + assignments.join(" ");
        const own = await shell.exec("env -i -0 " + assignments.join(" "));
        assert.equal(own.exitCode, code, own.stderr);
        // GNU 9.4/Linux and the recorded GNU 9.7/macOS order these entries differently.
        assert.deepEqual(own.stdout.split("\0").sort(), listing.toString().split("\0").sort());
        for (const command of ["env", "printenv"]) {
          const child = await shell.exec(prefix + " " + command + " -0");
          assert.equal(child.exitCode, code, child.stderr);
          assert.deepEqual(Buffer.from(child.stderrBytes), stderr);
          assert.deepEqual(child.stdoutBytes, own.stdoutBytes, shell.constructor.name + ": " + command);
        }
        const withoutZ = await shell.exec(prefix + " env -u Z printenv -0");
        assert.equal(withoutZ.exitCode, 0, withoutZ.stderr);
        assert.equal(withoutZ.stdout, own.stdout.split("\0").filter(entry => !entry.startsWith("Z=")).join("\0"));
      }
    });
    const binary = codecInput();
    for (const [compress, decompress, cat] of linuxCodecs) {
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
    if (cwd) await rm(cwd, { recursive: true, force: true });
    await ts.dispose();
    await rust.dispose();
  }
});
