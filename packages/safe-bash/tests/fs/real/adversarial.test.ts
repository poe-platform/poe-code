import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as native from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { collectBytes, toByteSource } from "../../../src/contracts/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { bytes, errno, fixture, text } from "./helpers.js";

test("raw traversal cannot turn virtual absolute or parent paths into host paths", async (context) => {
  const { filesystem, outside } = await fixture(context);
  await filesystem.mkdir("root-other");
  await filesystem.writeFile("/../../root-other/../secret", bytes("inside"));
  assert.equal(text(await filesystem.readFile("../../secret")), "inside");
  assert.equal(await native.readFile(join(outside, "secret"), "utf8"), "outside-secret");
  await filesystem.mkdir("//nested///child/./", { recursive: true });
  await filesystem.writeFile("nested/child/../file", bytes("normalized"));
  assert.equal(text(await filesystem.readFile("/nested/file")), "normalized");
  await assert.rejects(filesystem.readFile(join(outside, "secret")), errno("ENOENT"));
  await assert.rejects(filesystem.realpath(""), errno("ENOENT"));
});

test("POSIX names are not URL decoded or interpreted as Windows paths", async (context) => {
  const { filesystem } = await fixture(context);
  for (const path of ["..\\secret", "%2e%2e", "C:\\secret", "semi;colon", "雪\nfile"]) {
    await filesystem.writeFile(path, bytes(path));
    assert.equal(text(await filesystem.readFile(path)), path);
  }
  assert.equal((await filesystem.readdir("/")).length, 5);
});

for (const variant of ["absolute", "relative", "nested", "absolute-parent"] as const) {
  test(`all following operations refuse ${variant} symlink escapes`, async (context) => {
    const { filesystem, root, outside } = await fixture(context);
    if (variant === "nested") {
      await native.mkdir(join(root, "inside"));
      await native.symlink(outside, join(root, "inside", "hop"));
      await native.symlink("inside/hop", join(root, "escape"));
    } else {
      const target = variant === "absolute" ? outside
        : variant === "relative" ? "../root-other"
          : `${root}/../root-other`;
      await native.symlink(target, join(root, "escape"));
    }
    await filesystem.writeFile("safe", bytes("safe"));
    const operations = [
      () => filesystem.readFile("escape/secret"),
      () => filesystem.stat("escape/secret"),
      () => filesystem.lstat("escape/secret"),
      () => filesystem.readdir("escape"),
      () => filesystem.realpath("escape/secret"),
      () => filesystem.access("escape/secret"),
      () => filesystem.writeFile("escape/secret", bytes("bad")),
      () => filesystem.writeFile("escape/new", bytes("bad")),
      () => filesystem.appendFile("escape/secret", bytes("bad")),
      () => filesystem.truncate("escape/secret"),
      () => filesystem.chmod("escape/secret", 0o600),
      () => filesystem.utimes("escape/secret", 1000, 1000),
      () => filesystem.mkdir("escape/new/deep", { recursive: true }),
      () => filesystem.rm("escape/secret"),
      () => filesystem.rm("escape/new", { force: true }),
      () => filesystem.rename("escape/secret", "stolen"),
      () => filesystem.rename("safe", "escape/secret"),
      () => filesystem.copyFile("escape/secret", "stolen"),
      () => filesystem.copyFile("safe", "escape/secret"),
      () => filesystem.link("escape/secret", "stolen-link"),
      () => filesystem.link("safe", "escape/new"),
      () => filesystem.symlink("/safe", "escape/new-link"),
      () => filesystem.symlink("escape/secret", "new-link"),
      () => collectBytes(filesystem.readStream("escape/secret"), { maxBytes: 100 }),
      () => filesystem.writeStream("escape/secret", toByteSource("bad")),
    ];
    for (const operation of operations) await assert.rejects(operation(), errno("EACCES"));
    assert.equal(await native.readFile(join(outside, "secret"), "utf8"), "outside-secret");
    assert.deepEqual(await native.readdir(outside), ["secret"]);
    assert.equal(text(await filesystem.readFile("safe")), "safe");
  });
}

test("final external symlinks can be inspected, renamed, replaced, and removed without following", async (context) => {
  const { filesystem, root, outside } = await fixture(context);
  await native.symlink(join(outside, "secret"), join(root, "escape"));
  assert.equal((await filesystem.lstat("escape")).type, "symlink");
  await assert.rejects(filesystem.readlink("escape"), errno("EACCES"));
  await assert.rejects(filesystem.readFile("escape"), errno("EACCES"));
  await assert.rejects(filesystem.writeFile("escape", bytes("bad"), { flag: "wx" }), errno("EEXIST"));
  await filesystem.rename("escape", "renamed");
  await filesystem.rm("renamed", { recursive: true });
  await native.symlink(outside, join(root, "escape"));
  await filesystem.writeFile("safe", bytes("safe"));
  await filesystem.rename("safe", "escape");
  assert.equal(text(await filesystem.readFile("escape")), "safe");
  assert.equal(await native.readFile(join(outside, "secret"), "utf8"), "outside-secret");
});

test("recursive removal never follows symlink children to an outside tree", async (context) => {
  const { filesystem, root, outside } = await fixture(context);
  await filesystem.mkdir("tree");
  await native.symlink(outside, join(root, "tree", "outside"));
  await filesystem.rm("tree", { recursive: true });
  assert.equal(await native.readFile(join(outside, "secret"), "utf8"), "outside-secret");
});

test("dangling external symlinks cannot create files or recursive directories outside", async (context) => {
  const { filesystem, root, outside } = await fixture(context);
  await native.symlink(join(outside, "missing"), join(root, "dangling"));
  await assert.rejects(filesystem.writeFile("dangling", bytes("bad")), errno("EACCES"));
  await assert.rejects(filesystem.mkdir("dangling/child", { recursive: true }), errno("EACCES"));
  await filesystem.writeFile("safe", bytes("safe"));
  await assert.rejects(filesystem.copyFile("safe", "dangling"), errno("EACCES"));
  assert.deepEqual(await native.readdir(outside), ["secret"]);
});

test("symlink creation refuses relative escape, including prefix lookalikes", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.mkdir("dir");
  await assert.rejects(filesystem.symlink("../root-other/secret", "escape"), errno("EACCES"));
  await assert.rejects(filesystem.symlink("../../root-other/secret", "dir/escape"), errno("EACCES"));
  await filesystem.symlink("../missing", "dir/allowed");
  assert.equal(await filesystem.readlink("dir/allowed"), "../missing");
  await assert.rejects(filesystem.symlink("/../../virtual", "absolute-escape"), errno("EACCES"));
});

test("symlink target dot-dot follows actual directories rather than lexical shortcuts", async (context) => {
  const { filesystem, root } = await fixture(context);
  await filesystem.mkdir("first");
  await filesystem.mkdir("second/deep", { recursive: true });
  await filesystem.writeFile("first/file", bytes("wrong"));
  await filesystem.writeFile("second/file", bytes("right"));
  await filesystem.symlink("/second/deep", "first/hop");
  await filesystem.symlink("first/hop/../file", "link");
  assert.equal(text(await filesystem.readFile("link")), "right");
  assert.equal(await filesystem.realpath("link"), "/second/file");
  await native.symlink("../root-other/../root/second/file", join(root, "leave-and-return"));
  await assert.rejects(filesystem.readFile("leave-and-return"), errno("EACCES"));
});

test("self and multi-link cycles produce ELOOP, while lstat and rm do not follow them", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.symlink("self", "self");
  await filesystem.symlink("second", "first");
  await filesystem.symlink("first", "second");
  for (const path of ["self", "first", "second"]) {
    await assert.rejects(filesystem.stat(path), errno("ELOOP"));
    await assert.rejects(filesystem.readFile(path), errno("ELOOP"));
    await assert.rejects(filesystem.writeFile(path, bytes("bad")), errno("ELOOP"));
    assert.equal((await filesystem.lstat(path)).type, "symlink");
  }
  await filesystem.rm("self");
  await filesystem.rm("first");
  await filesystem.rm("second");
});

test("40 symlink traversals succeed but 41 report ELOOP", async (context) => {
  const { filesystem, root } = await fixture(context);
  await filesystem.writeFile("target", bytes("target"));
  for (let index = 40; index >= 0; index--) {
    await native.symlink(index === 40 ? "target" : `link-${index + 1}`, join(root, `link-${index}`));
  }
  assert.equal(text(await filesystem.readFile("link-1")), "target");
  await assert.rejects(filesystem.readFile("link-0"), errno("ELOOP"));
});

test("all root aliases resist removal and replacement", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.writeFile("file", bytes("keep"));
  for (const path of ["/", "//"]) {
    await assert.rejects(filesystem.rm(path, { recursive: true, force: true }), errno("EBUSY"));
    await assert.rejects(filesystem.rename("file", path), errno("EBUSY"));
    await assert.rejects(filesystem.rename(path, "other"), errno("EBUSY"));
  }
  for (const path of [".", ".."]) {
    await assert.rejects(filesystem.rm(path, { recursive: true, force: true }), errno("EINVAL"));
    await assert.rejects(filesystem.rename("file", path), errno("EINVAL"));
    await assert.rejects(filesystem.rename(path, "other"), errno("EINVAL"));
  }
  for (const path of ["", "/missing/.."]) {
    await filesystem.rm(path, { recursive: true, force: true });
    await assert.rejects(filesystem.rename("file", path), errno("ENOENT"));
    await assert.rejects(filesystem.rename(path, "other"), errno("ENOENT"));
  }
  assert.equal(text(await filesystem.readFile("file")), "keep");
});

test("root aliases pin the initial canonical directory and refuse later canonical-root symlink replacement", async (context) => {
  const { filesystem, temporary, root, outside } = await fixture(context);
  const alias = join(temporary, "alias");
  await native.symlink(root, alias);
  const aliased = await createRealFileSystem(alias);
  await native.unlink(alias);
  await native.symlink(outside, alias);
  await aliased.writeFile("inside", bytes("inside"));
  assert.equal(text(await filesystem.readFile("inside")), "inside");
  await native.rename(root, join(temporary, "original-root"));
  await native.symlink(outside, root);
  await assert.rejects(filesystem.readFile("secret"), errno("EACCES"));
  await assert.rejects(aliased.writeFile("secret", bytes("bad")), errno("EACCES"));
  assert.equal(await native.readFile(join(outside, "secret"), "utf8"), "outside-secret");
});

test("invalid paths and numeric arguments are rejected without mutation", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.writeFile("safe", bytes("safe"));
  const operations = [
    () => filesystem.readFile("bad\0path"),
    () => filesystem.writeFile("bad\0path", bytes("bad")),
    () => filesystem.rename("safe", "bad\0path"),
    () => filesystem.symlink("bad\0target", "link"),
    () => filesystem.chmod("safe", -1),
    () => filesystem.utimes("safe", NaN, 0),
    () => filesystem.truncate("safe", 1.5),
    () => filesystem.access("safe", 8),
    () => filesystem.writeFile("safe", bytes("bad"), { mode: -1 }),
  ];
  for (const operation of operations) await assert.rejects(operation(), errno("EINVAL"));
  assert.equal(text(await filesystem.readFile("safe")), "safe");
  assert.deepEqual((await filesystem.readdir("/")).map((entry) => entry.name), ["safe"]);
});

async function withSocket(root: string, action: (pid: number) => Promise<void>): Promise<void> {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", `
    import { createServer } from "node:net";
    const server = createServer();
    const fail = error => {
      process.stderr.write(error.message + "\\n");
      process.exitCode = 1;
      process.stdin.destroy();
    };
    server.on("error", fail);
    process.stdin.resume();
    process.stdin.once("end", () => server.close(error => { if (error) fail(error); }));
    server.listen("socket", () => process.stdout.write("ready"));
  `], { cwd: root, env: {}, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let streamError: Error | undefined;
  let timedOut = false;
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on("error", (error: Error) => { streamError ??= error; });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const ready = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => reject(new Error(stderr || `Socket fixture closed before readiness: ${code}/${signal}`)));
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout === "ready") resolve();
      else if (!"ready".startsWith(stdout)) reject(new Error("Invalid socket fixture readiness"));
    });
  });
  const deadline = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 5000);
  let failed = false;
  let failure: unknown;
  try {
    await ready;
    assert.ok(child.pid);
    assert.equal((await native.lstat(join(root, "socket"))).isSocket(), true);
    await action(child.pid);
  } catch (error) { failed = true; failure = error; }
  try { child.stdin.end(); }
  catch (error) { if (!failed) { failed = true; failure = error; } child.kill("SIGKILL"); }
  const outcome = await closed;
  clearTimeout(deadline);
  if (failed) throw failure;
  if (streamError) throw streamError;
  assert.equal(timedOut, false, "Socket fixture exceeded its shutdown deadline");
  assert.equal(outcome.code, 0, stderr);
  assert.equal(outcome.signal, null);
  assert.equal(stderr, "");
  for (const stream of [child.stdin, child.stdout, child.stderr]) assert.equal(stream.destroyed, true);
  await assert.rejects(native.lstat(join(root, "socket")), { code: "ENOENT" });
}

test("special filesystem nodes are rejected instead of pretending to be regular files", async (context) => {
  const { filesystem, root } = await fixture(context);
  await withSocket(root, async () => {
    await assert.rejects(filesystem.stat("socket"), errno("ENOTSUP"));
    await assert.rejects(filesystem.readFile("socket"), errno("ENOTSUP"));
    await assert.rejects(filesystem.writeFile("socket", bytes("bad")), errno("ENOTSUP"));
    await assert.rejects(filesystem.readdir("/"), errno("ENOTSUP"));
  });
});

for (const reason of [undefined, null, false, 0, "", new Error("socket assertion failed")]) {
  test(`socket fixture awaits child shutdown after primary rejection: ${String(reason)}`, async (context) => {
    const { root } = await fixture(context);
    let pid: number | undefined;
    await assert.rejects(withSocket(root, async childPid => { pid = childPid; throw reason; }), error => error === reason);
    const childPid = pid;
    assert.ok(childPid);
    assert.throws(() => process.kill(childPid, 0), { code: "ESRCH" });
    await assert.rejects(native.lstat(join(root, "socket")), { code: "ENOENT" });
  });
}

test("socket fixture bind failure preserves the existing entry and never runs product assertions", async (context) => {
  const { root } = await fixture(context);
  await native.writeFile(join(root, "socket"), "sentinel");
  await assert.rejects(withSocket(root, async () => { assert.fail("Socket fixture was not ready"); }), /EADDRINUSE/u);
  assert.equal(await native.readFile(join(root, "socket"), "utf8"), "sentinel");
});

test("socket fixture spawn failure is awaited without masking ENOENT", async (context) => {
  const { root } = await fixture(context);
  await assert.rejects(withSocket(join(root, "missing"), async () => { assert.fail("Socket fixture did not spawn"); }), { code: "ENOENT" });
});
