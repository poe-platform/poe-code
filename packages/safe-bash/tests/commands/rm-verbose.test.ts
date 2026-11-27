import assert from "node:assert/strict";
import { test } from "node:test";
import { FsError } from "../../src/contracts/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { Shell } from "../../src/shell/index.js";
import { fixture, run } from "./helpers.js";

test("rm -rv reports removed children before their directory", async context => {
  const fs = await fixture();
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("mkdir d; touch d/f; rm -rv d");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "removed 'd/f'\nremoved directory 'd'\n");
  await assert.rejects(fs.lstat("/work/d"), { code: "ENOENT" });
});

for (const operand of ["d", "./d", "d/", "/work/d"]) {
  test(`rm --recursive --verbose preserves operand spelling ${operand}`, async () => {
    const fs = await fixture({ "d/nested/f": "contents", "keep/f": "retained" });
    await fs.symlink("../keep", "/work/d/link");
    const result = await run("rm", ["--recursive", "--verbose", operand], { fs });
    const prefix = operand.endsWith("/") ? operand : `${operand}/`;
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(result.stdout.trimEnd().split("\n").sort(), [
      `removed '${prefix}link'`,
      `removed '${prefix}nested/f'`,
      `removed directory '${prefix}nested'`,
      `removed directory '${operand}'`,
    ].sort());
    assert.ok(result.stdout.indexOf(`removed '${prefix}nested/f'`) < result.stdout.indexOf(`removed directory '${prefix}nested'`));
    assert.ok(result.stdout.endsWith(`removed directory '${operand}'\n`));
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/keep/f")), "retained");
    await assert.rejects(fs.lstat("/work/d"), { code: "ENOENT" });
  });
}

test("rm -dv labels empty directories and rm -fv does not report missing operands", async () => {
  const fs = await fixture({ file: "" });
  await fs.mkdir("/work/empty");
  const directory = await run("rm", ["-dv", "empty"], { fs });
  assert.equal(directory.exitCode, 0, directory.stderr);
  assert.equal(directory.stdout, "removed directory 'empty'\n");
  const files = await run("rm", ["-fv", "missing", "file"], { fs });
  assert.equal(files.exitCode, 0, files.stderr);
  assert.equal(files.stderr, "");
  assert.equal(files.stdout, "removed 'file'\n");
});

test("rm -rv reports completed removals but not a failed file or its parent", async () => {
  const fs = await fixture({ first: "", "d/f": "retained" });
  const rm = fs.rm.bind(fs);
  fs.rm = async (path, options) => {
    if (path === "/work/d/f") throw new FsError("EACCES", { path });
    await rm(path, options);
  };
  const result = await run("rm", ["-rv", "first", "d"], { fs });
  assert.equal(result.exitCode, 1);
  assert.notEqual(result.stderr, "");
  assert.equal(result.stdout, "removed 'first'\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/d/f")), "retained");
});

test("rm -rfv does not report a directory that disappears before removal", async () => {
  const fs = await fixture();
  await fs.mkdir("/work/d");
  const rmdir = fs.rmdir.bind(fs);
  fs.rmdir = async (path, options) => {
    await rmdir(path, options);
    throw new FsError("ENOENT", { path });
  };
  const result = await run("rm", ["-rfv", "d"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
