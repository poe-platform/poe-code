import assert from "node:assert/strict";
import test from "node:test";
import * as host from "node:fs/promises";
import { join } from "node:path";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { namespace, oracle, run, snapshot } from "./helpers.js";
import { qualifyModeFixtures } from "./permission-profile/fixtures.js";

test("GNU chmod seeded symbolic/numeric differential: 384 mode transitions", async context => {
  const root = await namespace(context);
  await host.writeFile(join(root, "file"), Buffer.from([0, 255, 10]));
  await host.mkdir(join(root, "directory"));
  const qualified = await qualifyModeFixtures(root, ["file", "directory"]);
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work/directory", { recursive: true });
  await fs.writeFile("/work/file", Uint8Array.of(0, 255, 10));
  const modes = ["=r", "=rw", "=", "a=r", "u=rw,g=u,o=g", "a-x,a+X", "u+x,g+X", "ug+s", "a-s", "o+t", "u=rw+x", "g=u-w", "755", "0755", "00755", "=755", "+111", "-111", "u-rwx,g+u", "+w", "-w", "a=rwX", "u=,g=u", "u+s,g-s,o=t"];
  const masks = [0, 0o022, 0o077, 0o200];
  let seed = 0x6d657461;
  const failures: unknown[] = [];
  for (let iteration = 0; iteration < 384; iteration++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const initial = seed & 0o777;
    const name = iteration % 2 ? "directory" : "file";
    const mode = modes[iteration % modes.length]!;
    const umask = masks[Math.floor(iteration / modes.length) % masks.length]!;
    await qualified.setMode(name, initial);
    await fs.chmod(`/work/${name}`, initial);
    const native = oracle("chmod", ["--", mode, name], root, umask);
    const actual = await run("chmod", ["--", mode, name], fs, { umask });
    const expectedMode = (await host.stat(join(root, name))).mode & 0o7777;
    const actualMode = (await fs.stat(`/work/${name}`)).mode & 0o7777;
    if (native.exitCode !== actual.exitCode || expectedMode !== actualMode) failures.push({ iteration, initial: initial.toString(8), name, mode, umask: umask.toString(8), native: native.exitCode, actual: actual.exitCode, expectedMode: expectedMode.toString(8), actualMode: actualMode.toString(8) });
  }
  await fs.chmod("/work/file", 0o600);
  await host.chmod(join(root, "file"), 0o600);
  assert.deepEqual(await fs.readFile("/work/file"), Uint8Array.of(0, 255, 10));
  assert.deepEqual(await host.readFile(join(root, "file")), Buffer.from([0, 255, 10]));
  assert.deepEqual(failures, []);
});

test("GNU stat format matrix compares exact bytes over actual RealFS metadata", async context => {
  const root = await namespace(context);
  await host.mkdir(join(root, "work"));
  await host.writeFile(join(root, "work/file"), Buffer.from([0, 255, 10, 32]));
  await host.chmod(join(root, "work/file"), 0o751);
  await host.utimes(join(root, "work/file"), 1700000000.125, 1700000000.875);
  const fs = await createRealFileSystem({ root });
  const formats = ["%n|%s|%a|%A|%f|%F", "%i:%h:%u:%g:%d:%D", "[%08a][%#08a][%+8a][% 8a]", "[%08s][%+08s][%-8s]", "%X|%.0X|%.1X|%.2X|%.3X", "%%|\\377\\x80\\0|%s", "[%#08f][%+08f][%#08D]", "[%.2n][%8.2n]", "[%.6s][%.6a][%.6f]", "[%N]"];
  const failures: unknown[] = [];
  for (const format of formats) {
    const native = oracle("stat", [`--printf=${format}`, "file"], join(root, "work"), 0o022, { QUOTING_STYLE: "shell-always" });
    const actual = await run("stat", [`--printf=${format}`, "file"], fs, {}, { env: { QUOTING_STYLE: "shell-always" } });
    if (native.exitCode !== actual.exitCode || !native.stdout.equals(actual.stdout)) failures.push({ format, expected: native.stdout.toString(), actual: actual.stdout.toString(), error: actual.stderr });
  }
  assert.deepEqual(await fs.readFile("/work/file"), Uint8Array.of(0, 255, 10, 32));
  assert.deepEqual(failures, []);
});

test("GNU mktemp option/template controls preserve result shape and private modes", async context => {
  const root = await namespace(context);
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.mkdir("/tmp");
  const cases = [["item.XXX"], ["item.XXXX.txt"], ["--suffix=.log", "item.XXXX"], ["-d", "folder.XXXX"], ["-u", "dry.XXXX"], ["--suffix=", "item.XXXX.txt"], ["-q", "bad"], ["--", "-file.XXXX"], ["-p", ".", "file.XXXX"], ["--tmpdir=", "file.XXXX"]];
  const failures: unknown[] = [];
  for (const [index, args] of cases.entries()) {
    const umask = index % 2 ? 0o277 : 0o022;
    const native = oracle("mktemp", args, root, umask);
    const actual = await run("mktemp", args, fs, { umask }, { env: { TMPDIR: "/work" } });
    if (native.exitCode !== actual.exitCode || Boolean(native.stderr) !== Boolean(actual.stderr)) failures.push({ args, native: native.exitCode, actual: actual.exitCode, nativeError: native.stderr, actualError: actual.stderr });
    if (native.exitCode === 0 && actual.exitCode === 0 && !args.includes("-u")) {
      const nativePath = native.stdout.toString().trimEnd();
      const virtualPath = actual.stdout.toString().trimEnd();
      const nativeStat = await host.stat(join(root, nativePath.startsWith("/") ? nativePath.slice(root.length + 1) : nativePath));
      const virtualStat = await fs.stat(virtualPath.startsWith("/") ? virtualPath : `/work/${virtualPath}`);
      assert.equal(virtualStat.mode & 0o777, nativeStat.mode & 0o777, JSON.stringify(args));
      assert.equal(virtualStat.type === "directory", nativeStat.isDirectory());
      if (virtualStat.type === "file") assert.equal(virtualStat.size, 0);
    }
  }
  assert.deepEqual(failures, []);
});

for (const operand of ["tree", "start", "dangling"]) test(`GNU chmod recursive symlink control: ${operand}`, async context => {
  const root = await namespace(context);
  const real = await createRealFileSystem({ root });
  const memory = new MemoryFileSystem();
  for (const fs of [real, memory]) {
    await fs.mkdir("/work/tree/sub", { recursive: true, mode: 0o755 });
    await fs.writeFile("/work/tree/sub/file", Uint8Array.of(255, 0), { mode: 0o600 });
    await fs.writeFile("/work/sentinel", Uint8Array.of(9), { mode: 0o600 });
    await fs.symlink("../sentinel", "/work/tree/link");
    await fs.symlink("tree", "/work/start");
    await fs.symlink("missing", "/work/dangling");
  }
  for (const path of ["work/start", "work/dangling", "work/tree/link"]) await host.lchmod(join(root, path), 0o777);
  const native = oracle("chmod", ["-R", "a+rX", operand], join(root, "work"));
  const actual = await run("chmod", ["-R", "a+rX", operand], memory);
  assert.equal(actual.exitCode, native.exitCode, native.stderr);
  assert.deepEqual(await snapshot(memory), await snapshot(real));
});
