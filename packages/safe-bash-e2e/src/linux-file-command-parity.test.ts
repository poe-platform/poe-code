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
      "mv -ub data/alias data/input",
      "mv -b data/input data/./input",
      "mv -ib data/alias data/input",
      "mv -bv data/alias data/input",
      "stat -c '%a %s %h' data/input data/input~",
      "ln data/input~ data/alias",
      "mv --backup=numbered data/alias data/input",
      "mkdir data/incoming",
      "ln data/input data/incoming/input",
      "mv --backup=numbered -v data/incoming/input data/input",
      "rmdir data/incoming",
      "ln data/input data/alias",
      "mv --backup=simple -v data/alias data/input",
      "mv --backup=simple data/input~ data/input",
      "mv -b data/input~ data/input",
      "printf old >data/dest",
      "ln data/alias data/dest~",
      "mv -bv data/alias data/dest",
      "cat data/dest~",
      "mv --backup=numbered data/dest~ data/dest",
      "ln data/input data/alias",
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
      const expected = spawnSync("/bin/sh", ["-c", "umask 022; " + script], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
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
    // Two routes to one entry must never displace a pre-existing backup.
    for (const [shell, view] of [[ts.shell, ts.fs], [rust, rust.fs]] as const) {
      await view.symlink!("data", "/workspace/via");
      const before = await view.readFile("/workspace/data/input");
      await view.unlink!("/workspace/data/input~");
      await view.writeFile("/workspace/data/input~", Buffer.from("previous backup"));
      const result = await shell.exec("mv -b via/input data/input");
      assert.equal(result.exitCode, 1);
      assert.equal(result.stderr, "mv: 'via/input' and 'data/input' are the same file\n");
      assert.deepEqual(await view.readFile("/workspace/data/input"), before);
      assert.deepEqual(Buffer.from(await view.readFile("/workspace/data/input~")), Buffer.from("previous backup"));
    }
  } finally {
    await ts.dispose();
    await rust.dispose();
    await rm(cwd, {recursive:true, force:true});
  }
});
