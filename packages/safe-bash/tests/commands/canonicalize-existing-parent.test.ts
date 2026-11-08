import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../src/contracts/index.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";
import { fixture, run } from "./helpers.js";

for (const [command, flags] of [
  ["readlink", ["-f"]], ["readlink", ["--canonicalize"]],
  ["realpath", []], ["realpath", ["-E"]], ["realpath", ["--canonicalize"]],
] as const) {
  test(`${command} ${flags.join(" ")} resolves dangling final links with existing parents`, async () => {
    const fs = await fixture({ "dir/file": "" });
    for (const [link, target] of [
      ["relative", "missing"], ["absolute", "/work/missing"], ["chain", "relative"],
      ["nested", "dir/missing"], ["trailing", "missing/"], ["alias", "dir"],
    ]) await fs.symlink(target!, `/work/${link}`);
    const result = await run(command, [...flags, "relative", "absolute", "chain", "nested", "trailing", "alias/missing"], { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "/work/missing\n/work/missing\n/work/missing\n/work/dir/missing\n/work/missing\n/work/dir/missing\n");
  });

  test(`${command} ${flags.join(" ")} rejects absent ancestors, non-directories and link cycles`, async () => {
    const fs = await fixture({ file: "" });
    for (const [link, target] of [["bad", "absent/missing"], ["cycle", "cycle"], ["dangling", "missing"]]) {
      await fs.symlink(target!, `/work/${link}`);
    }
    for (const operand of ["bad", "cycle", "dangling/child", "file/child", "file/", "absent/../file"]) {
      const result = await run(command, [...flags, operand], { fs });
      assert.equal(result.exitCode, 1, operand);
      assert.equal(result.stdout, "", operand);
    }
    assert.equal((await run(command, ["-e", "dangling"], { fs })).exitCode, 1);
  });
}

for (const flags of [["-L"], ["--logical"], ["-Le"], ["-L", "-e"], ["-sL"]]) {
  test(`realpath ${flags.join(" ")} checks directories before lexical normalization`, async () => {
    const fs = await fixture({ file: "", "dir/file": "" });
    for (const operand of ["file/", "file///", "file/.", "file/..", "absent/../file"]) {
      const result = await run("realpath", [...flags, operand], { fs });
      assert.equal(result.exitCode, 1, operand);
      assert.equal(result.stdout, "", operand);
      assert.ok(result.stderr.includes(operand.startsWith("file") ? "ENOTDIR" : "ENOENT"), result.stderr);
    }
    const directory = await run("realpath", [...flags, "dir///"], { fs });
    assert.equal(directory.exitCode, 0, directory.stderr);
    assert.equal(directory.stdout, "/work/dir\n");
  });
}

test("canonicalization retains physical/logical selection, missing mode and shell output controls", async context => {
  const fs = await fixture({ "dir/deep/file": "", file: "" });
  await fs.symlink("dir/deep", "/work/alias");
  await fs.symlink("missing", "/work/dangling");
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  context.after(() => shell.dispose());
  for (const [source, expected] of [
    ["readlink -fn dangling", "/work/missing"],
    ["realpath -z --relative-to=. dangling", "missing\0"],
    ["realpath -P alias/../new", "/work/dir/new\n"],
    ["realpath -L alias/../new", "/work/new\n"],
    ["realpath -Lm file/child", "/work/file/child\n"],
    ["realpath -L missing/", "/work/missing\n"],
  ]) {
    const result = await shell.exec(source!);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  }
});

test("dangling canonicalization preserves capability errors and cancellation", async context => {
  const fs = await fixture();
  await fs.symlink("missing", "/work/link");
  const deniedFs = new Proxy(fs, { get(target, property) {
    if (property === "capabilitiesFor") return async () => ({ ...fs.capabilities, readlink: false });
    const original: unknown = Reflect.get(target, property);
    return typeof original === "function" ? original.bind(target) : original;
  } });
  const denied = await run("realpath", ["link"], { fs: deniedFs });
  assert.equal(denied.exitCode, 1);
  assert.equal(denied.stdout, "");
  assert.ok(denied.stderr.includes("ENOTSUP"), denied.stderr);
  context.mock.restoreAll();
  for (const reason of [false, new Error("stop resolution")]) {
    const controller = new AbortController();
    context.mock.method(fs, "readlink", async () => {
      controller.abort(reason);
      throw new FsError("ENOENT");
    });
    await assert.rejects(run("realpath", ["link"], { fs, signal: controller.signal }), error => error === reason);
    context.mock.restoreAll();
  }
});
