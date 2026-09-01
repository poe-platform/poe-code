import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run, snapshot } from "./helpers.js";

test("stat types/link-follow/aliases format metadata without namespace mutation", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work", { mode: 0o755 });
  await fs.writeFile("/work/-literal space", Uint8Array.of(0, 255, 10), { mode: 0o640 });
  await fs.writeFile("/work/empty", new Uint8Array(), { mode: 0o644 });
  await fs.symlink("-literal space", "/work/link");
  await fs.symlink("absent", "/work/dangling");
  await fs.link("/work/-literal space", "/work/alias");
  const before = await snapshot(fs);
  for (const follow of [false, true]) for (const name of ["-literal space", "empty", "link", "alias", "."]) {
    const args = [...follow ? ["-L"] : [], "-c%N:%F:%s:%a:%A:%i:%h", "--", name];
    const actual = await run("stat", args, fs, {}, { env: { QUOTING_STYLE: "literal" } });
    assert.equal(actual.exitCode, 0, actual.stderr);
    const info = await (follow ? fs.stat(`/work/${name}`) : fs.lstat(`/work/${name}`));
    const type = info.type === "directory" ? "directory" : info.type === "symlink" ? "symbolic link" : info.size === 0 ? "regular empty file" : "regular file";
    const access = info.type === "directory" ? "drwxr-xr-x" : info.type === "symlink" ? "lrwxrwxrwx" : name === "empty" ? "-rw-r--r--" : "-rw-r-----";
    const label = info.type === "symlink" ? `${name} -> -literal space` : name;
    assert.equal(actual.stdout.toString(), `${label}:${type}:${info.size}:${(info.mode & 0o7777).toString(8)}:${access}:${info.ino}:${info.nlink}\n`, `${name} ${follow}`);
    assert.equal(actual.stderr, "");
  }
  assert.deepEqual(await snapshot(fs), before);
  assert.equal((await fs.stat("/work/alias")).ino, (await fs.stat("/work/-literal space")).ino);
});

test("stat missing/dangling operands preserve later output, typed API errors and all entries", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/file", Uint8Array.of(3, 2, 1));
  await fs.symlink("absent", "/work/dangling");
  const before = await snapshot(fs);
  for (const follow of [false, true]) {
    const args = [...follow ? ["-L"] : [], "-c%n:%F", "missing", "dangling", "file"];
    const actual = await run("stat", args, fs);
    assert.equal(actual.exitCode, 1);
    assert.equal(actual.stdout.toString(), `${follow ? "" : "dangling:symbolic link\n"}file:regular file\n`);
    assert.match(actual.stderr, /missing/u);
    assert.match(actual.stderr, /no such|not found|ENOENT/iu);
    if (follow) assert.match(actual.stderr, /dangling/u);
  }
  await assert.rejects(fs.stat("/work/dangling"), error => error instanceof FsError && error.code === "ENOENT");
  assert.deepEqual(await snapshot(fs), before);
});
