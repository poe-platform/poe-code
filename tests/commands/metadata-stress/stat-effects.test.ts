import assert from "node:assert/strict";
import test from "node:test";
import * as host from "node:fs/promises";
import { join } from "node:path";
import { FsError } from "../../../src/contracts/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { namespace, oracle, run, snapshot } from "./helpers.js";

test("GNU stat types/link-follow/aliases compare exact bytes without namespace mutation", async context => {
  const root = await namespace(context);
  await host.mkdir(join(root, "work"));
  const fs = await createRealFileSystem({ root });
  await fs.writeFile("/work/-literal space", Uint8Array.of(0, 255, 10), { mode: 0o640 });
  await fs.writeFile("/work/empty", new Uint8Array());
  await fs.symlink("-literal space", "/work/link");
  await fs.symlink("absent", "/work/dangling");
  await fs.link("/work/-literal space", "/work/alias");
  const before = await snapshot(fs);
  for (const follow of [false, true]) for (const name of ["-literal space", "empty", "link", "alias", "."]) {
    const args = [...follow ? ["-L"] : [], "-c%N:%F:%s:%a:%A:%i:%h", "--", name];
    const native = oracle("stat", args, join(root, "work"), 0o022, { QUOTING_STYLE: "literal" });
    const actual = await run("stat", args, fs, {}, { env: { QUOTING_STYLE: "literal" } });
    assert.equal(actual.exitCode, native.exitCode, actual.stderr);
    assert.deepEqual(actual.stdout, native.stdout, `${name} ${follow}`);
    assert.equal(actual.stderr, "");
  }
  assert.deepEqual(await snapshot(fs), before);
  assert.equal((await fs.stat("/work/alias")).ino, (await fs.stat("/work/-literal space")).ino);
});

test("stat missing/dangling operands preserve later output, typed API errors and all entries", async context => {
  const root = await namespace(context);
  await host.mkdir(join(root, "work"));
  const fs = await createRealFileSystem({ root });
  await fs.writeFile("/work/file", Uint8Array.of(3, 2, 1));
  await fs.symlink("absent", "/work/dangling");
  const before = await snapshot(fs);
  for (const follow of [false, true]) {
    const args = [...follow ? ["-L"] : [], "-c%n:%F", "missing", "dangling", "file"];
    const native = oracle("stat", args, join(root, "work"));
    const actual = await run("stat", args, fs);
    assert.equal(native.exitCode, 1);
    assert.equal(actual.exitCode, 1);
    assert.deepEqual(actual.stdout, native.stdout);
    assert.match(actual.stderr, /missing/u);
    assert.match(actual.stderr, /no such|not found|ENOENT/iu);
    if (follow) assert.match(actual.stderr, /dangling/u);
  }
  await assert.rejects(fs.stat("/work/dangling"), error => error instanceof FsError && error.code === "ENOENT");
  assert.deepEqual(await snapshot(fs), before);
});
