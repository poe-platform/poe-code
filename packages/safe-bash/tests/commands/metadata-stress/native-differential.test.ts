import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run, snapshot } from "./helpers.js";

test("chmod seeded symbolic/numeric operations preserve file contents: 384 transitions", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work/directory", { recursive: true });
  await fs.writeFile("/work/file", Uint8Array.of(0, 255, 10));
  const modes = ["=r", "=rw", "=", "a=r", "u=rw,g=u,o=g", "a-x,a+X", "u+x,g+X", "ug+s", "a-s", "o+t", "u=rw+x", "g=u-w", "755", "0755", "00755", "=755", "+111", "-111", "u-rwx,g+u", "+w", "-w", "a=rwX", "u=,g=u", "u+s,g-s,o=t"];
  const masks = [0, 0o022, 0o077, 0o200];
  let seed = 0x6d657461;
  for (let iteration = 0; iteration < 384; iteration++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const initial = seed & 0o777;
    const name = iteration % 2 ? "directory" : "file";
    const mode = modes[iteration % modes.length]!;
    const umask = masks[Math.floor(iteration / modes.length) % masks.length]!;
    await fs.chmod(`/work/${name}`, initial);
    const actual = await run("chmod", ["--", mode, name], fs, { umask });
    assert.equal(actual.exitCode, 0, actual.stderr);
  }
  await fs.chmod("/work/file", 0o600);
  assert.deepEqual(await fs.readFile("/work/file"), Uint8Array.of(0, 255, 10));
});

test("stat format matrix succeeds without changing file bytes", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/file", Uint8Array.of(0, 255, 10, 32), { mode: 0o751 });
  await fs.utimes("/work/file", 1700000000125, 1700000000875);
  const formats = ["%n|%s|%a|%A|%f|%F", "%i:%h:%u:%g:%d:%D", "[%08a][%#08a][%+8a][% 8a]", "[%08s][%+08s][%-8s]", "%X|%.0X|%.1X|%.2X|%.3X", "%%|\\377\\x80\\0|%s", "[%#08f][%+08f][%#08D]", "[%.2n][%8.2n]", "[%.6s][%.6a][%.6f]", "[%N]"];
  for (const format of formats) {
    const actual = await run("stat", [`--printf=${format}`, "file"], fs, {}, { env: { QUOTING_STYLE: "shell-always" } });
    assert.equal(actual.exitCode, 0, actual.stderr);
  }
  assert.deepEqual(await fs.readFile("/work/file"), Uint8Array.of(0, 255, 10, 32));
});

test("mktemp option/template controls preserve result shape and private modes", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.mkdir("/tmp");
  const cases = [["item.XXX"], ["item.XXXX.txt"], ["--suffix=.log", "item.XXXX"], ["-d", "folder.XXXX"], ["-u", "dry.XXXX"], ["--suffix=", "item.XXXX.txt"], ["-q", "bad"], ["--", "-file.XXXX"], ["-p", ".", "file.XXXX"], ["--tmpdir=", "file.XXXX"]];
  for (const [index, args] of cases.entries()) {
    const umask = index % 2 ? 0o277 : 0o022;
    const actual = await run("mktemp", args, fs, { umask }, { env: { TMPDIR: "/work" } });
    assert.equal(actual.exitCode, args[0] === "--suffix=" || args[0] === "-q" ? 1 : 0, JSON.stringify(args));
    if (actual.exitCode === 0 && !args.includes("-u")) {
      const virtualPath = actual.stdout.toString().trimEnd();
      const virtualStat = await fs.stat(virtualPath.startsWith("/") ? virtualPath : `/work/${virtualPath}`);
      assert.equal(virtualStat.mode & 0o777, (args.includes("-d") ? 0o700 : 0o600) & ~umask, JSON.stringify(args));
      assert.equal(virtualStat.type === "directory", args.includes("-d"));
      if (virtualStat.type === "file") assert.equal(virtualStat.size, 0);
    }
  }
});

for (const operand of ["tree", "start", "dangling"]) test(`chmod recursive symlink control: ${operand}`, async () => {
  const memory = new MemoryFileSystem();
  await memory.mkdir("/work/tree/sub", { recursive: true, mode: 0o755 });
  await memory.writeFile("/work/tree/sub/file", Uint8Array.of(255, 0), { mode: 0o600 });
  await memory.writeFile("/work/sentinel", Uint8Array.of(9), { mode: 0o600 });
  await memory.symlink("../sentinel", "/work/tree/link");
  await memory.symlink("tree", "/work/start");
  await memory.symlink("missing", "/work/dangling");
  const expected = await snapshot(memory);
  const expectedFile = expected.find(entry => (entry as { path: string }).path === "/work/tree/sub/file") as { mode: number };
  assert.ok(expectedFile);
  if (operand !== "dangling") expectedFile.mode = 0o644;
  const actual = await run("chmod", ["-R", "a+rX", operand], memory);
  assert.equal(actual.exitCode, operand === "dangling" ? 1 : 0, actual.stderr);
  assert.deepEqual(await snapshot(memory), expected);
});
