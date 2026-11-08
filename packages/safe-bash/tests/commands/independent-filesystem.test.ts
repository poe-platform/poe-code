import assert from "node:assert/strict";
import test from "node:test";
import { fixture, run } from "./helpers.js";
import { Shell } from "../../src/shell/shell.js";
import { agentCommands } from "../../src/plugins/index.js";

for (const option of ["--target-directory=target", "--target-directory target", "-t target", "-ttarget", "-vt target"]) {
  test(`cp copies multiple sources with ${option}`, async () => {
    const fs = await fixture({ input: "abc\n", second: "def\n" });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(`mkdir target; cp ${option} input second`);
    assert.equal(result.exitCode, 0, result.stderr);
    for (const [name, bytes] of [["input", "abc\n"], ["second", "def\n"]]) {
      assert.equal(Buffer.from(await fs.readFile(`/work/target/${name}`)).toString(), bytes);
      assert.equal(Buffer.from(await fs.readFile(`/work/${name}`)).toString(), bytes);
    }
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, option === "-vt target" ? "'input' -> 'target/input'\n'second' -> 'target/second'\n" : "");
  });
}

for (const option of ["--no-target-directory", "-T"]) {
  test(`cp treats the destination as a single path with ${option}`, async () => {
    const fs = await fixture({ input: "abc\n", "source/child": "nested" });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    const result = await shell.exec(`cp ${option} input output`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.from(await fs.readFile("/work/output")).toString(), "abc\n");
    await fs.mkdir("/work/target");
    const rejected = await shell.exec(`cp ${option} input target`);
    assert.notEqual(rejected.exitCode, 0);
    await assert.rejects(fs.stat("/work/target/input"), { code: "ENOENT" });
    const directory = await shell.exec(`cp -R ${option} source target`);
    assert.equal(directory.exitCode, 0, directory.stderr);
    assert.equal(Buffer.from(await fs.readFile("/work/target/child")).toString(), "nested");
    await assert.rejects(fs.stat("/work/target/source"), { code: "ENOENT" });
  });
}

test("cp rejects invalid target-directory invocations without copying", async () => {
  for (const args of [["-t"], ["-t", "target"], ["-t", "target", "-T", "input"], ["-T", "input", "second", "target"], ["-t", "missing", "input"], ["-t", "input", "second"], ["-t", "target", "-t", "target", "input"]]) {
    const fs = await fixture({ input: "abc\n", second: "def\n" });
    await fs.mkdir("/work/target");
    const result = await run("cp", args, { fs });
    assert.notEqual(result.exitCode, 0, args.join(" "));
    assert.deepEqual(await fs.readdir("/work/target"), []);
    assert.equal(Buffer.from(await fs.readFile("/work/input")).toString(), "abc\n");
  }
});

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
