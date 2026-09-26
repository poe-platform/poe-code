import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileSystem } from "../../../src/contracts/index.js";
import { filesystem, run } from "./helpers.js";

for (const type of ["character", "fifo"] as const) test(`diff reads a top-level ${type} input without relying on stat size`, async () => {
  const fs = await filesystem({ stream: "a\nb\n", file: "a\nb\n" });
  const view = new Proxy(fs, { get(target, key) {
    if (key === "stat" || key === "lstat") return async (...args: Parameters<FileSystem["stat"]>) => {
      const stat = await target[key](...args);
      return args[0] === "/work/stream" ? { ...stat, type, size: 0 } : stat;
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  for (const args of [["stream", "file"], ["file", "stream"]]) {
    const result = await run("diff", ["-u", ...args], { fs: view });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  }
  const limited = await run("diff", ["-u", "stream", "file"], { fs: view, options: { maxInputBytes: 3 } });
  assert.equal(limited.exitCode, 2);
  assert.equal(limited.stdout, "");
  assert.equal(limited.stderr, "diff: EFBIG: output exceeds maxBytes, collectBytes\n");
});

test("recursive diff reports character special files without reading them", async () => {
  const fs = await filesystem({ "left/file": "", "right/file": "content\n" });
  const view = new Proxy(fs, { get(target, key) {
    if (key === "stat" || key === "lstat") return async (...args: Parameters<FileSystem["stat"]>) => {
      const stat = await target[key](...args);
      return args[0] === "/work/left/file" ? { ...stat, type: "character" as const } : stat;
    };
    if (key === "readStream") return () => { throw new Error("Must not read a nested device"); };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await run("diff", ["-r", "left", "right"], { fs: view });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, "File left/file is a character special file while file right/file is a regular file\n");
  assert.equal(result.stderr, "");
});

test("diff no-dereference preserves symbolic-link comparison for stdin aliases", async () => {
  const fs = await filesystem({ file: "same\n" });
  await fs.mkdir("/dev/fd", { recursive: true });
  for (const path of ["/dev/stdin", "/dev/fd/0"]) {
    await fs.symlink("/work/file", path);
    const result = await run("diff", ["--no-dereference", path, "file"], { fs, input: "same\n" });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, `File ${path} is a symbolic link while file file is a regular file\n`);
    assert.equal(result.stderr, "");
  }
});

for (const acquisition of [false, true]) test(`diff pins input across ancestor swap during ${acquisition ? "acquisition" : "pathname read"}`, async () => {
  const fs = await filesystem({ "left/sub/a": "same\n", "right/sub/a": "same\n", "private/a": "SECRET_ORIGIN_KEY\n" });
  const swap = async () => {
    await fs.rename("/work/left/sub", "/work/left/retired");
    await fs.symlink("/work/private", "/work/left/sub");
  };
  const wrapped = new Proxy(fs, { get(target, key) {
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } }) as FileSystem;
  const overrides = Object.create(wrapped) as FileSystem;
  if (acquisition) {
    const open = fs.openReadFile.bind(fs);
    overrides.openReadFile = async (path, options) => {
      if (path === "/work/left/sub/a") await swap();
      return open(path, options);
    };
  } else {
    const stream = fs.readStream.bind(fs);
    overrides.readStream = async function* (path, options) {
      if (path === "/work/left/sub/a") await swap();
      yield* stream(path, options);
    };
  }
  const result = await run("diff", ["-u", "left/sub/a", "right/sub/a"], { fs: overrides });
  assert.equal(result.stdout.includes("SECRET_ORIGIN_KEY"), false);
  assert.equal(result.exitCode, acquisition ? 2 : 0, result.stderr);
});

test("diff retained content survives an ancestor swap during handle reading", async () => {
  const fs = await filesystem({ "left/sub/a": "same\n", "right/sub/a": "same\n", "private/a": "SECRET_ORIGIN_KEY\n" });
  const open = fs.openReadFile.bind(fs);
  const wrapped = new Proxy(fs, { get(target, key) {
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } }) as FileSystem;
  const overrides = Object.create(wrapped) as FileSystem;
  overrides.openReadFile = async (path, options) => {
    const handle = await open(path, options);
    if (path !== "/work/left/sub/a") return handle;
    const read = handle.read.bind(handle);
    return { ...handle, async read(position, size, options) {
      await fs.rename("/work/left/sub", "/work/left/retired");
      await fs.symlink("/work/private", "/work/left/sub");
      return read(position, size, options);
    } };
  };
  const result = await run("diff", ["-u", "left/sub/a", "right/sub/a"], { fs: overrides });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("diff fails closed without retained read capability", async () => {
  const fs = await filesystem({ left: "same\n", right: "same\n" });
  const wrapped = new Proxy(fs, { get(target, key) {
    if (key === "capabilities") return { ...target.capabilities, retainedRead: false };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await run("diff", ["left", "right"], { fs: wrapped });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /requires identity-checked retained reads/u);
});

test("directory loop detection also works without provider inode identities", async () => {
  const fs = await filesystem();
  await fs.mkdir("/work/left");
  await fs.mkdir("/work/right");
  await fs.symlink(".", "/work/left/loop");
  await fs.symlink(".", "/work/right/loop");
  const wrapped = new Proxy(fs, { get(target, key) {
    if (key === "stat" || key === "lstat") return async (...args: Parameters<FileSystem["stat"]>) => {
      const stat = { ...await target[key](...args) };
      delete stat.identityScope;
      delete stat.dev;
      delete stat.ino;
      return stat;
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await run("diff", ["-r", "left", "right"], { fs: wrapped, options: { maxFiles: 8 } });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /left\/loop: recursive directory loop/u);
});
