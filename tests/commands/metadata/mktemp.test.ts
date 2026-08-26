import assert from "node:assert/strict";
import test from "node:test";
import * as native from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsError, type FileSystem, type WriteFileOptions } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { runMetadata } from "./helpers.js";

async function fixture() {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.mkdir("/tmp");
  return fs;
}

test("mktemp defaults create private VFS files, not host temporary files", async () => {
  const fs = await fixture();
  const names = new Set<string>();
  for (let index = 0; index < 20; index++) {
    const result = await runMetadata("mktemp", [], fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /^\/tmp\/tmp\.[a-zA-Z0-9]{10}\n$/u);
    const name = result.stdout.trimEnd();
    names.add(name);
    const stat = await fs.stat(name);
    assert.equal(stat.type, "file");
    assert.equal(stat.mode & 0o777, 0o600);
    assert.equal(stat.size, 0);
  }
  assert.equal(names.size, 20);
});

test("mktemp directory, tmpdir priority, inferred and explicit suffixes", async () => {
  const fs = await fixture();
  await fs.mkdir("/work/env");
  for (const [args, pattern] of [
    [["-d", "-p", "/work", "unit.XXXXXX"], /^\/work\/unit\.[a-zA-Z0-9]{6}\n$/u],
    [["--tmpdir", "a.XXXX.json"], /^\/work\/env\/a\.[a-zA-Z0-9]{4}\.json\n$/u],
    [["--tmpdir=/tmp", "--suffix=.js", "a.XXX"], /^\/tmp\/a\.[a-zA-Z0-9]{3}\.js\n$/u],
    [["./a.XXXX.log"], /^\.\/a\.[a-zA-Z0-9]{4}\.log\n$/u],
  ] as const) {
    const result = await runMetadata("mktemp", args, fs, {}, undefined, { TMPDIR: "/work/env" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, pattern);
    const path = result.stdout.trimEnd();
    const stat = await fs.stat(path.startsWith("/") ? path : `/work/${path}`);
    assert.equal(stat.mode & 0o777, args.some(argument => argument === "-d") ? 0o700 : 0o600);
  }
});

test("mktemp dry-run reserves nothing and does not require permissions support", async () => {
  const backing = await fixture();
  const fs = new Proxy(backing, { get(target, property) {
    if (property === "capabilities") return { ...target.capabilities, permissions: false };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const result = await runMetadata("mktemp", ["-u", "-p", "/tmp", "name.XXXX"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await backing.readdir("/tmp"), []);
  const creation = await runMetadata("mktemp", [], fs);
  assert.equal(creation.exitCode, 1);
  assert.match(creation.stderr, /ENOTSUP/u);
  assert.deepEqual(await backing.readdir("/tmp"), []);
});

test("mktemp collision retries use exclusive creation and preserve the competing file", async () => {
  const backing = await fixture();
  const attempts: string[] = [];
  const fs: FileSystem = new Proxy(backing, { get(target, property) {
    if (property === "writeFile") return async (path: string, data: Uint8Array, options?: WriteFileOptions) => {
      attempts.push(path);
      assert.equal(options?.flag, "wx");
      assert.equal(options?.mode, 0o600);
      if (attempts.length === 1) {
        await target.writeFile(path, Uint8Array.of(1, 255));
        throw new FsError("EEXIST", { path });
      }
      return target.writeFile(path, data, options);
    };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const result = await runMetadata("mktemp", ["-p/tmp", "data.XXXXXX"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(attempts.length, 2);
  assert.deepEqual(await backing.readFile(attempts[0]!), Uint8Array.of(1, 255));
  assert.equal(result.stdout, `${attempts[1]}\n`);
});

test("mktemp bounds collisions, reports quiet failure, and preserves cancellation", async () => {
  const backing = await fixture();
  let calls = 0;
  const fs = new Proxy(backing, { get(target, property) {
    if (property === "writeFile") return async () => { calls++; throw new FsError("EEXIST"); };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const result = await runMetadata("mktemp", ["-q"], fs, { limits: { maxAttempts: 3 } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal(calls, 3);
  const controller = new AbortController();
  const reason = new Error("stop temporary creation");
  controller.abort(reason);
  await assert.rejects(runMetadata("mktemp", [], fs, {}, controller.signal), error => error === reason);
  assert.equal(calls, 3);
});

test("mktemp refuses malformed templates and preflights output quota before creation", async () => {
  const fs = await fixture();
  for (const args of [["xx.XX"], ["a.XXX.fooXX"], ["-p/tmp", "/absolute.XXX"], ["--suffix=/bad", "a.XXX"], ["--suffix=.txt", "a.XXX.old"], ["a\0.XXX"], ["first.XXX", "second.XXX"], ["-t", "x"]]) {
    assert.equal((await runMetadata("mktemp", args, fs)).exitCode, 1, JSON.stringify(args));
  }
  const limited = await runMetadata("mktemp", [], fs, { limits: { maxOutputBytes: 1 } });
  assert.equal(limited.exitCode, 1);
  assert.match(limited.stderr, /limit/u);
  assert.deepEqual(await fs.readdir("/tmp"), []);
  assert.deepEqual(await fs.readdir("/work"), []);
});

test("mktemp missing virtual tmp directory never falls back to the host", async () => {
  const fs = new MemoryFileSystem();
  const result = await runMetadata("mktemp", [], fs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ENOENT/u);
  assert.deepEqual(await fs.readdir("/"), []);
});

test("mktemp output failure is not retried as a creation collision", async () => {
  const fs = await fixture();
  const result = await runMetadata("mktemp", [], fs, {}, undefined, {}, async () => { throw new FsError("EEXIST", { syscall: "write stdout" }); });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EEXIST/u);
  assert.equal(result.stdout, "");
  assert.equal((await fs.readdir("/tmp")).length, 1);
});

test("mktemp cancellation inside exclusive creation preserves the abort reason", async () => {
  const backing = await fixture();
  const controller = new AbortController();
  const reason = new FsError("EEXIST", { message: "abort is not a collision" });
  let calls = 0;
  const fs = new Proxy(backing, { get(target, property) {
    if (property === "writeFile") return async (_path: string, _bytes: Uint8Array, options?: WriteFileOptions) => {
      calls++;
      assert.equal(options?.signal, controller.signal);
      controller.abort(reason);
      throw reason;
    };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  await assert.rejects(runMetadata("mktemp", [], fs, {}, controller.signal), error => error === reason);
  assert.equal(calls, 1);
  assert.deepEqual(await backing.readdir("/tmp"), []);
});

test("mktemp directory collisions never remove a competing nonempty directory", async () => {
  const backing = await fixture();
  const attempted: string[] = [];
  const fs = new Proxy(backing, { get(target, property) {
    if (property === "mkdir") return async (path: string, options?: Parameters<FileSystem["mkdir"]>[1]) => {
      attempted.push(path);
      assert.equal(options?.recursive, false);
      assert.equal(options?.mode, 0o700);
      if (attempted.length === 1) {
        await target.mkdir(path);
        await target.writeFile(`${path}/kept`, Uint8Array.of(7));
        throw new FsError("EEXIST");
      }
      await target.mkdir(path, options);
    };
    const member: unknown = Reflect.get(target, property, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
  const result = await runMetadata("mktemp", ["-d"], fs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(attempted.length, 2);
  assert.deepEqual(await backing.readFile(`${attempted[0]}/kept`), Uint8Array.of(7));
});

for (const directory of [false, true]) {
  test(`mktemp private ${directory ? "directory" : "file"} modes match native in an isolated real root`, async context => {
    const root = await native.mkdtemp(join(tmpdir(), "safe-bash-mktemp-"));
    context.after(() => native.rm(root, { recursive: true, force: true }));
    await native.mkdir(join(root, "work"));
    const oracle = spawnSync("/usr/bin/mktemp", [...directory ? ["-d"] : [], join(root, "native.XXXXXX")], { encoding: "utf8", timeout: 2000 });
    assert.equal(oracle.status, 0, oracle.stderr);
    const nativeStat = await native.stat(oracle.stdout.trimEnd());
    const fs = await createRealFileSystem({ root });
    const result = await runMetadata("mktemp", [...directory ? ["-d"] : [], "-p", "/work", "virtual.XXXXXX"], fs);
    assert.equal(result.exitCode, 0, result.stderr);
    const stat = await fs.stat(result.stdout.trimEnd());
    assert.equal(stat.mode & 0o777, nativeStat.mode & 0o777);
    assert.equal(stat.type === "directory", directory);
  });
}
