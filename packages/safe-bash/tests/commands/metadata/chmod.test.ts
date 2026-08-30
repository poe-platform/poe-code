import assert from "node:assert/strict";
import test from "node:test";
import * as native from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { runMetadata } from "./helpers.js";

const cases = [
  [0o644, "755", 0o755], [0o777, "a-rwx,u+rw", 0o600], [0o600, "ug+x", 0o710],
  [0o741, "o+g", 0o745], [0o740, "g=u,o=g", 0o777], [0o644, "a+X", 0o644],
  [0o744, "a+X", 0o755], [0o777, "a-x,a+X", 0o666, 0o777], [0o644, "u+x,g+X", 0o754, 0o744],
  [0o666, "=r", 0o444], [0o644, "u+t", 0o644], [0o644, "o+s", 0o644],
  [0o644, "+x", 0o755], [0o666, "-w", 0o466], [0o644, "u=rw+x", 0o744],
] as const;

function nativeChmodOptions(root: string) {
  return {
    cwd: join(root, "work"),
    env: { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root, LC_ALL: "C", LANG: "C", TZ: "UTC" },
    encoding: "utf8" as const,
    timeout: 2000,
  };
}

test("chmod oracle options use owned paths and an explicit clean environment", () => {
  const parent = process.env;
  try {
    process.env = { ...parent, PATH: "/untrusted", HOME: "/unowned", TMPDIR: "/unowned", BASH_ENV: "/startup", ENV: "/startup", SHELLOPTS: "xtrace", BASHOPTS: "extdebug", NODE_OPTIONS: "--import=/loader", "BASH_FUNC_chmod%%": "() { false; }" };
    const options = nativeChmodOptions("/owned/oracle");
    assert.deepEqual(options, {
      cwd: "/owned/oracle/work",
      env: { PATH: "/usr/bin:/bin", HOME: "/owned/oracle", TMPDIR: "/owned/oracle", LC_ALL: "C", LANG: "C", TZ: "UTC" },
      encoding: "utf8",
      timeout: 2000,
    });
    assert.equal(process.env.BASH_ENV, "/startup", "oracle setup must not modify the parent environment");
  } finally {
    process.env = parent;
  }
});

for (const [initial, mode, expected, bsdExpected] of cases) {
  test(`chmod GNU mode ${initial.toString(8)} ${mode}; ${bsdExpected === undefined ? "shared" : "distinct"} BSD observation`, async context => {
    const root = await native.mkdtemp(join(tmpdir(), "safe-bash-chmod-"));
    context.after(() => native.rm(root, { recursive: true, force: true }));
    await native.mkdir(join(root, "work"));
    await native.writeFile(join(root, "work", "file"), "payload");
    await native.chmod(join(root, "work", "file"), initial);
    const oracle = spawnSync("/bin/bash", ["--noprofile", "--norc", "-c", "umask 022; /bin/chmod -- \"$1\" file", "oracle", mode], nativeChmodOptions(root));
    assert.equal(oracle.status, 0, oracle.stderr);
    assert.equal((await native.stat(join(root, "work", "file"))).mode & 0o7777, bsdExpected ?? expected);
    const fs = await createRealFileSystem({ root });
    await fs.chmod("/work/file", initial);
    const result = await runMetadata("chmod", ["--", mode, "file"], fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await fs.stat("/work/file")).mode & 0o7777, expected);
    assert.equal(Buffer.from(await fs.readFile("/work/file")).toString(), "payload");
  });
}

test("chmod GNU directory setid preservation and explicit clearing", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  for (const [mode, expected] of [["755", 0o6755], ["0755", 0o6755], ["00755", 0o755], ["=755", 0o755], ["u=rwx,go=rx", 0o6755], ["a-s", 0o755]] as const) {
    await fs.chmod("/work", 0o6755);
    const result = await runMetadata("chmod", [mode, "/work"], fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await fs.stat("/work")).mode & 0o7777, expected, mode);
  }
});

test("chmod recursive changes skip descendant symlinks and follow command-line links", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work/tree/sub", { recursive: true });
  await fs.writeFile("/work/tree/sub/file", new Uint8Array(), { mode: 0o600 });
  await fs.writeFile("/work/outside", new Uint8Array(), { mode: 0o600 });
  await fs.symlink("../outside", "/work/tree/link");
  await fs.symlink("tree", "/work/start");
  assert.equal((await runMetadata("chmod", ["-R", "a+rX", "start"], fs)).exitCode, 0);
  assert.equal((await fs.stat("/work/tree/sub/file")).mode & 0o777, 0o644);
  assert.equal((await fs.stat("/work/outside")).mode & 0o777, 0o600);
  assert.equal((await fs.lstat("/work/tree/link")).type, "symlink");
});

test("chmod reference, quiet errors, literal paths and invalid modes", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/reference", new Uint8Array(), { mode: 0o751 });
  await fs.writeFile("/work/a b;$x", new Uint8Array(), { mode: 0o600 });
  assert.equal((await runMetadata("chmod", ["--reference=reference", "a b;$x"], fs)).exitCode, 0);
  assert.equal((await fs.stat("/work/a b;$x")).mode & 0o777, 0o751);
  for (const mode of ["888", "u+q", "u=ug", "", "a+r,", "10000"]) {
    assert.equal((await runMetadata("chmod", [mode, "a b;$x"], fs)).exitCode, 1, mode);
    assert.equal((await fs.stat("/work/a b;$x")).mode & 0o777, 0o751);
  }
  const quiet = await runMetadata("chmod", ["-f", "600", "missing"], fs);
  assert.equal(quiet.exitCode, 1);
  assert.equal(quiet.stderr, "");
  assert.equal((await runMetadata("chmod", ["-R", "777", "/"], fs)).exitCode, 1);
});

test("chmod capabilities, cancellation and traversal quotas remain explicit", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work/tree", { recursive: true });
  await fs.writeFile("/work/tree/file", Uint8Array.of(7));
  const unsupported = new Proxy(fs, { get(target, property) { return property === "chmod" ? undefined : Reflect.get(target, property); } });
  const denied = await runMetadata("chmod", ["777", "tree"], unsupported);
  assert.equal(denied.exitCode, 1);
  assert.match(denied.stderr, /ENOTSUP/u);
  const limited = await runMetadata("chmod", ["-R", "a+rX", "tree"], fs, { limits: { maxEntries: 1 } });
  assert.equal(limited.exitCode, 1);
  assert.match(limited.stderr, /limit/u);
  const controller = new AbortController();
  const reason = new Error("stop chmod");
  controller.abort(reason);
  await assert.rejects(runMetadata("chmod", ["777", "tree/file"], fs, {}, controller.signal), error => error === reason);
  assert.deepEqual(await fs.readFile("/work/tree/file"), Uint8Array.of(7));
});
