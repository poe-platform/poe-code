import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { RustWasmBash } from "@poe-code/safe-bash-rust";
import { SafeBashE2EHarness, sb } from "./harness.js";

test("GNU diff and patch exchange unified diffs with TypeScript and Rust", async () => {
  const env = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };
  const out = fileURLToPath(new URL("../../../out/", import.meta.url));
  await mkdir(out, { recursive: true });
  const cwd = await mkdtemp(out + "gnu-diff-");
  const ts = await SafeBashE2EHarness.create({ env, fs: new sb.MemoryFileSystem() });
  const rust = new RustWasmBash({ env, cwd: "/workspace", forceNative: true });
  const native = (command: string, args: string[]) =>
    spawnSync("/usr/bin/" + command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  try {
    for (const [before, after] of [
      ["", "new line\n"],
      ["café\nend", "café\nlast"],
      ["a\r\nb\r\n", "a\r\nc\r\n"],
      ["old\none\ntwo\nthree\nfour\nfive\nlast\n", "new\none\ntwo\nthree\nfour\nfive\nlast"]
    ] as const) {
      await writeFile(cwd + "/before", before);
      await writeFile(cwd + "/after", after);
      const args = ["-U1", "--label", "before", "--label", "after", "before", "after"];
      const reference = native("diff", args);
      assert.equal(reference.status, 1, reference.stderr.toString());
      for (const [shell, view] of [
        [ts.shell, ts.fs],
        [rust, rust.fs]
      ] as const) {
        await view.writeFile("/workspace/before", Buffer.from(before));
        await view.writeFile("/workspace/after", Buffer.from(after));
        const generated = await shell.exec("diff " + args.join(" "));
        assert.equal(generated.exitCode, reference.status, generated.stderr);
        assert.deepEqual(Buffer.from(generated.stderrBytes), reference.stderr);
        assert.deepEqual(
          Buffer.from(generated.stdoutBytes),
          reference.stdout,
          shell.constructor.name + ": " + JSON.stringify(before)
        );
        await writeFile(cwd + "/delta", generated.stdoutBytes);
        await writeFile(cwd + "/work", before);
        const applied = native("patch", ["--batch", "-i", "delta", "work"]);
        assert.equal(applied.status, 0, applied.stderr.toString());
        assert.deepEqual(await readFile(cwd + "/work"), Buffer.from(after));
        await view.writeFile("/workspace/work", Buffer.from(before));
        const imported = await shell.exec("patch --batch work", { stdin: reference.stdout });
        assert.equal(imported.exitCode, applied.status, imported.stderr);
        assert.deepEqual(Buffer.from(imported.stdoutBytes), applied.stdout);
        assert.deepEqual(Buffer.from(imported.stderrBytes), applied.stderr);
        assert.deepEqual(
          Buffer.from(await view.readFile("/workspace/work")),
          Buffer.from(after),
          shell.constructor.name
        );
      }
    }
  } finally {
    await ts.dispose();
    await rust.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});
