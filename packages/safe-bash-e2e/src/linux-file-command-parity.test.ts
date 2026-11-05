import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { RustWasmBash } from "@poe-code/safe-bash-rust";
import { SafeBashE2EHarness, sb } from "./harness.js";

test("Linux file commands preserve the same bytes, links and permissions in TypeScript and Rust", async () => {
  const env = { PATH: "/usr/bin:/bin", LC_ALL: "C", TZ: "UTC" };
  const out = fileURLToPath(new URL("../../../out/", import.meta.url));
  await mkdir(out, { recursive: true });
  const cwd = await mkdtemp(out + "linux-files-");
  const ts = await SafeBashE2EHarness.create({ env, fs: new sb.MemoryFileSystem() });
  const rust = new RustWasmBash({ env, cwd: "/workspace", forceNative: true });
  try {
    for (const script of [
      "mkdir -m 750 data",
      "printf 'one\\ntwo\\nthree\\nfour\\n' >data/input",
      "chmod 640 data/input",
      "ln data/input data/alias",
      "cp data/input data/alias",
      "mv data/alias data/input",
      "mv -f data/input data/alias",
      "mv -u data/input data/alias",
      "mv -i data/input data/alias",
      "ln -s input data/first",
      "ln -s input data/ref",
      "mv data/first data/ref",
      "readlink data/ref",
      "touch -d @1700000000 data/ref",
      "cp -p data/ref data/copy",
      "stat -c '%a %s %h %Y' data/input data/alias data/copy",
      "truncate -s +3 data/alias",
      "stat -c '%a %s %h' data/input data/copy",
      "install -m 600 data/copy data/installed",
      "mv data/installed data/moved",
      "split -l 2 data/copy data/part",
      "csplit -f data/section data/copy 3",
      "cmp data/copy data/moved",
      "diff data/partaa data/section00",
      "ls -1 data",
      "rm data/ref data/alias",
      "mkdir data/empty",
      "rmdir data/empty",
      "stat -c '%a %h' data data/input data/moved",
    ]) {
      const expected = spawnSync("/bin/sh", ["-c", "umask 022; " + script], { cwd, env });
      assert.notEqual(expected.status, null, expected.error?.message);
      for (const shell of [ts.shell, rust]) {
        const result = await shell.exec(script);
        const label = shell.constructor.name + ": " + script;
        assert.equal(result.exitCode, expected.status, label);
        assert.equal(result.stderr, expected.stderr.toString(), label);
        assert.deepEqual(Buffer.from(result.stdoutBytes), expected.stdout, label);
      }
    }
    const names = (await readdir(cwd + "/data")).sort();
    for (const view of [ts.fs, rust.fs]) {
      assert.deepEqual((await view.readdir("/workspace/data")).map(entry => entry.name).sort(), names);
      for (const name of names) {
        assert.deepEqual(Buffer.from(await view.readFile("/workspace/data/" + name)), await readFile(cwd + "/data/" + name), name);
      }
    }
  } finally {
    await ts.dispose();
    await rust.dispose();
    await rm(cwd, {recursive:true, force:true});
  }
});
