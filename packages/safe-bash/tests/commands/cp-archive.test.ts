import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

for (const option of ["-x", "--one-file-system"]) {
  test(`cp ${option} accepts recursive and ordinary copies`, async () => {
    const fs = await fixture({ source: "source", "tree/child": "child" });
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    try {
      for (const command of [`cp ${option} -R tree output`, `cp ${option} source copied`]) {
        const result = await shell.exec(command);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
      }
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/output/child")), "child");
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/copied")), "source");
    } finally { await shell.dispose(); }
  });
}

for (const identity of ["different-device", "different-scope", "missing-device", "missing-scope", "invalid-device"] as const) {
  test(`cp -Rx handles ${identity} directory boundaries without inventing identity`, async () => {
    const fs = await fixture({ "tree/child": "child", "tree/mount/nested": "nested" });
    const stat = fs.stat.bind(fs);
    const otherScope = Symbol("other-storage");
    fs.stat = async (path, options) => {
      const entry = await stat(path, options);
      if (path !== "/work/tree/mount") return entry;
      const { dev, identityScope, ...metadata } = entry;
      return {
        ...metadata,
        ...(identity === "missing-device" ? {} : { dev: identity === "invalid-device" ? NaN : dev! + 1 }),
        ...(identity === "missing-scope" || identityScope === undefined ? {} : {
          identityScope: identity === "different-scope" ? otherScope : identityScope,
        }),
      };
    };
    const shell = new Shell({ fs, cwd: "/work", deviceView: "provided" }).use(agentCommands());
    try {
      const result = await shell.exec("cp -Rx tree output");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal((await fs.stat("/work/output/mount")).type, "directory");
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/output/child")), "child");
      if (identity === "different-device" || identity === "different-scope") {
        assert.deepEqual(await fs.readdir("/work/output/mount"), []);
      } else {
        assert.equal(new TextDecoder().decode(await fs.readFile("/work/output/mount/nested")), "nested");
      }
      const direct = await shell.exec("cp -Rx tree/mount direct");
      assert.equal(direct.exitCode, 0, direct.stderr);
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/direct/nested")), "nested");
      const control = await shell.exec("cp -R tree control");
      assert.equal(control.exitCode, 0, control.stderr);
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/control/mount/nested")), "nested");
    } finally { await shell.dispose(); }
  });
}

test("cp -H accepts ordinary files and follows only command-line symbolic links", async () => {
  const fs = await fixture({ source: "SYNTHETIC_SOURCE\n", "tree/child": "CHILD\n" });
  await fs.symlink("source", "/work/source-link");
  await fs.symlink("child", "/work/tree/link");
  await fs.symlink("missing", "/work/tree/dangling");
  await fs.symlink("tree", "/work/tree-link");
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    for (const source of ["source", "source-link"]) {
      const result = await shell.exec(`cp -H ${source} ${source}-copy`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.equal((await fs.lstat(`/work/${source}-copy`)).type, "file");
      assert.equal(new TextDecoder().decode(await fs.readFile(`/work/${source}-copy`)), "SYNTHETIC_SOURCE\n");
    }
    const recursive = await shell.exec("cp -RH tree-link copy");
    assert.equal(recursive.exitCode, 0, recursive.stderr);
    assert.equal(recursive.stdout, "");
    assert.equal(recursive.stderr, "");
    assert.equal((await fs.lstat("/work/copy")).type, "directory");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/copy/child")), "CHILD\n");
    assert.equal(await fs.readlink("/work/copy/link"), "child");
    assert.equal(await fs.readlink("/work/copy/dangling"), "missing");
    const unsupported = await shell.exec("cp --dereference-command-line source invalid");
    assert.equal(unsupported.exitCode, 2);
    await assert.rejects(fs.lstat("/work/invalid"), { code: "ENOENT" });
  } finally { await shell.dispose(); }
});

for (const option of ["--archive", "-a"]) {
  test(`cp ${option} copies directory trees and preserves symbolic links`, async () => {
    const fs = await fixture({ "tree/input": "abc\n", "tree/deep/file": "nested" });
    await fs.mkdir("/work/tree/empty");
    await fs.symlink("input", "/work/tree/link");
    await fs.symlink("missing", "/work/tree/dangling");
    await fs.symlink("tree", "/work/alias");
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    try {
      const result = await shell.exec(`cp ${option} tree copy; cat copy/input`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "abc\n");
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/copy/deep/file")), "nested");
      assert.equal((await fs.stat("/work/copy/empty")).type, "directory");
      assert.equal(await fs.readlink("/work/copy/link"), "input");
      assert.equal(await fs.readlink("/work/copy/dangling"), "missing");
      const link = await shell.exec(`cp ${option} alias copied-alias`);
      assert.equal(link.exitCode, 0, link.stderr);
      assert.equal(await fs.readlink("/work/copied-alias"), "tree");
    } finally { await shell.dispose(); }
  });
}

test("archive copies retain verbose, no-clobber and self-copy protection", async () => {
  const fs = await fixture({ "tree/input": "new", "target/tree/input": "kept" });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec("cp -av tree copy");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "'tree/input' -> 'copy/input'\n" + "'tree' -> 'copy'\n");
    const skipped = await shell.exec("cp -an tree target");
    assert.equal(skipped.exitCode, 0, skipped.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/target/tree/input")), "kept");
    const recursive = await shell.exec("cp -a tree tree/inside");
    assert.equal(recursive.exitCode, 1);
    assert.ok(recursive.stderr.includes("cannot copy a directory into itself"));
    await assert.rejects(fs.stat("/work/tree/inside"), { code: "ENOENT" });
  } finally { await shell.dispose(); }
});
