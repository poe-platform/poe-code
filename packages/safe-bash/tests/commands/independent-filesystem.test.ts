import assert from "node:assert/strict";
import test from "node:test";
import { fixture, run } from "./helpers.js";

test("forced hard linking never removes the source through a dotted alias", async () => {
  const fs = await fixture({ file: "preserve me" });
  const result = await run("ln", ["-f", "./file", "file"], { fs });
  assert.notEqual(result.exitCode, 0);
  assert.equal(Buffer.from(await fs.readFile("/work/file")).toString(), "preserve me");
});

test("forced hard linking rejects a source reached through a parent symlink", async () => {
  const fs = await fixture({ "data/file": "preserve me" });
  await fs.symlink("data", "/work/alias");
  const result = await run("ln", ["-f", "alias/file", "data/file"], { fs });
  assert.notEqual(result.exitCode, 0);
  assert.equal(Buffer.from(await fs.readFile("/work/data/file")).toString(), "preserve me");
});

test("forced hard linking still supports distinct names for the same inode", async () => {
  const fs = await fixture({ file: "preserve me" });
  await fs.link("/work/file", "/work/alias");
  const result = await run("ln", ["-f", "file", "alias"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.stat("/work/file")).nlink, 2);
  assert.equal(Buffer.from(await fs.readFile("/work/alias")).toString(), "preserve me");
});

test("physical symlink copy replaces a dangling destination without following it", async () => {
  const fs = await fixture();
  await fs.symlink("missing", "/work/source");
  await fs.symlink("other-missing", "/work/target");
  const result = await run("cp", ["-P", "source", "target"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await fs.readlink("/work/target"), "missing");
  await assert.rejects(fs.stat("/work/missing"), { code: "ENOENT" });
});

test("physical symlink copy detects self aliases without replacing the source", async () => {
  const fs = await fixture();
  await fs.symlink("missing", "/work/source");
  const result = await run("cp", ["-P", "./source", "source"], { fs });
  assert.notEqual(result.exitCode, 0);
  assert.equal(await fs.readlink("/work/source"), "missing");
});

test("physical symlink copy no-clobber preserves a dangling destination", async () => {
  const fs = await fixture();
  await fs.symlink("missing", "/work/source");
  await fs.symlink("other-missing", "/work/target");
  const result = await run("cp", ["-Pn", "source", "target"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await fs.readlink("/work/target"), "other-missing");
});
