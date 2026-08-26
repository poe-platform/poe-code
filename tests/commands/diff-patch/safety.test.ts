import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type FileSystem } from "../../../src/contracts/index.js";
import { contents, filesystem, replacement, run } from "./helpers.js";

for (const path of ["../target", "dir/../../target", "/work/target", "a/../target", "C:/target", "a\\target", "target\rname", "./..", "target\u007f"]) {
  test(`patch rejects unsafe header before or after strip: ${JSON.stringify(path)}`, async () => {
    for (const args of path === "/work/target" ? [[], ["-p1"]] : [[], ["-p1"], ["target"]]) {
      const result = await run("patch", args, { files: { target: "old\n" }, input: replacement.replace("+++ target", `+++ ${path}`) });
      assert.equal(result.exitCode, 2, result.stderr);
      assert.equal(await contents(result.fs, "target"), "old\n");
    }
  });
}

test("explicit targets reject traversal even with safe patch headers", async () => {
  const result = await run("patch", ["../target"], { files: { target: "old\n" }, input: replacement });
  assert.equal(result.exitCode, 2);
  assert.equal(await contents(result.fs, "target"), "old\n");
});

test("strip removing the entire pathname is an error", async () => {
  assert.equal((await run("patch", ["-p1"], { files: { target: "old\n" }, input: replacement })).exitCode, 2);
});

test("selected-path policy rejects symlink target, retained ancestor (-p0), and patch input", async () => {
  const fs = await filesystem({ target: "old\n", "dir/target": "old\n", input: replacement });
  await fs.symlink("target", "/work/alias");
  await fs.symlink("dir", "/work/linkdir");
  await fs.symlink("input", "/work/linkinput");
  for (const path of ["alias", "linkdir/target"]) {
    const result = await run("patch", path === "linkdir/target" ? ["-p0"] : [], { fs, input: replacement.replaceAll("target", path) });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /symlink/u);
  }
  const input = await run("patch", ["-i", "linkinput"], { fs });
  assert.equal(input.exitCode, 2);
  assert.equal(await contents(fs, "target"), "old\n");
  assert.equal(await contents(fs, "dir/target"), "old\n");
});

test("dangling symlinks cannot become creation targets", async () => {
  const fs = await filesystem();
  await fs.symlink("missing", "/work/target");
  const result = await run("patch", [], { fs, input: "--- /dev/null\n+++ target\n@@ -0,0 +1 @@\n+created\n" });
  assert.equal(result.exitCode, 2);
  assert.equal(await fs.readlink("/work/target"), "missing");
});

test("hard-linked targets are rejected to avoid modifying aliases", async () => {
  const fs = await filesystem({ target: "old\n" });
  await fs.link("/work/target", "/work/alias");
  const result = await run("patch", [], { fs, input: replacement });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /hard-linked/u);
  assert.equal(await contents(fs, "alias"), "old\n");
});

test("directory targets are never overwritten", async () => {
  const fs = await filesystem({ "target/child": "retained" });
  const result = await run("patch", [], { fs, input: replacement });
  assert.equal(result.exitCode, 2);
  assert.equal(await contents(fs, "target/child"), "retained");
});

for (const binary of [Buffer.from([0, 65]), Buffer.from([0xff, 10]), Buffer.from([0xc3, 10])]) {
  test(`binary rejection preserves bytes ${binary.toString("hex")}`, async () => {
    const diff = await run("diff", ["old", "new"], { files: { old: binary, new: "text\n" } });
    assert.equal(diff.exitCode, 2);
    assert.match(diff.stderr, /binary input/u);
    assert.equal(diff.stdout, "");
    const patch = await run("patch", [], { files: { target: binary }, input: replacement });
    assert.equal(patch.exitCode, 2);
    assert.deepEqual(Buffer.from(await patch.fs.readFile("/work/target")), binary);
    const binaryPatch = await run("patch", [], { files: { target: "old\n" }, input: binary });
    assert.equal(binaryPatch.exitCode, 2);
    assert.equal(await contents(binaryPatch.fs, "target"), "old\n");
  });
}

test("line/matrix/work/input/output limits fail closed", async () => {
  for (const options of [{ maxLines: 1 }, { maxMatrixCells: 1 }, { maxWork: 1 }, { maxInputBytes: 1 }, { maxOutputBytes: 1 }]) {
    const diff = await run("diff", ["old", "new"], { files: { old: "old\n", new: "new\n" }, options });
    assert.equal(diff.exitCode, 2, JSON.stringify(options));
    assert.equal(diff.stdout, "");
  }
  for (const options of [{ maxLines: 1 }, { maxWork: 1 }, { maxInputBytes: 1 }, { maxOutputBytes: 1 }]) {
    const patch = await run("patch", [], { files: { target: "old\n" }, input: replacement, options });
    assert.equal(patch.exitCode, 2, JSON.stringify(options));
    assert.equal(await contents(patch.fs, "target"), "old\n");
  }
});

test("file and hunk budgets apply across complete invocations", async () => {
  const input = replacement + replacement.replaceAll("target", "other");
  for (const options of [{ maxFiles: 1 }, { maxHunks: 1 }]) {
    const result = await run("patch", [], { files: { target: "old\n", other: "old\n" }, input, options });
    assert.equal(result.exitCode, 2);
    assert.equal(await contents(result.fs, "target"), "old\n");
  }
  const diff = await run("diff", ["-r", "left", "right"], { files: { "left/a": "a", "left/b": "b", "right/a": "A" }, options: { maxFiles: 1 } });
  assert.equal(diff.exitCode, 2);
  assert.equal(diff.stdout, "");
});

test("invalid configuration reports usage failure before mutation", async () => {
  for (const value of [0, -1, NaN, Infinity, 0.5]) {
    const result = await run("patch", [], { files: { target: "old\n" }, input: replacement, options: { maxWork: value } });
    assert.equal(result.exitCode, 2);
    assert.equal(await contents(result.fs, "target"), "old\n");
  }
});

test("commit failures stop later files and disclose the committed prefix", async () => {
  const fs = await filesystem({ first: "old\n", second: "old\n", third: "old\n" });
  const originalWrite = fs.writeFile.bind(fs);
  fs.writeFile = async (path, data, options) => {
    if (path === "/work/second") throw new FsError("ENOSPC", { path });
    return originalWrite(path, data, options);
  };
  const input = ["first", "second", "third"].map(path => replacement.replaceAll("target", path)).join("");
  const result = await run("patch", [], { fs, input });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /1\/3 files committed/u);
  assert.match(result.stderr, /may have side effects/u);
  assert.equal(await contents(fs, "first"), "new\n");
  assert.equal(await contents(fs, "second"), "old\n");
  assert.equal(await contents(fs, "third"), "old\n");
});

test("--atomic late mutation in precommit validation prevents all command writes", async () => {
  const fs = await filesystem({ target: "old\n" });
  const originalRead = fs.readFile.bind(fs);
  let reads = 0;
  const wrapper = new Proxy(fs, {
    get(target, key) {
      if (key === "readStream") return undefined;
      if (key === "readFile") return async (path: string, options: Parameters<FileSystem["readFile"]>[1]) => {
        if (path === "/work/target" && ++reads === 2) await fs.writeFile(path, Buffer.from("concurrent\n"));
        return originalRead(path, options);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const result = await run("patch", ["--atomic"], { fs: wrapper, input: replacement });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /changed during preflight/u);
  assert.equal(await contents(fs, "target"), "concurrent\n");
});

test("output budget is checked before writing any patch target", async () => {
  const result = await run("patch", [], { files: { target: "old\n" }, input: replacement, options: { maxOutputBytes: 4 } });
  assert.equal(result.exitCode, 2);
  assert.equal(await contents(result.fs, "target"), "old\n");
});

test("hostile directory entry names never become filesystem paths", async () => {
  const fs = await filesystem({ "left/file": "old", "right/file": "new" });
  fs.readdir = async () => [{ name: "../escape", type: "file" }];
  const result = await run("diff", ["-r", "left", "right"], { fs });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /unsafe directory entry/u);
});

test("excessive path lengths and depths are bounded before filesystem traversal", async () => {
  for (const path of ["a".repeat(4097), "dir/".repeat(257) + "target"]) {
    const result = await run("patch", [], { files: { target: "old\n" }, input: replacement.replaceAll("target", path) });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /path length/u);
    const diff = await run("diff", [path, "target"], { files: { target: "old\n" } });
    assert.equal(diff.exitCode, 2);
    assert.match(diff.stderr, /path length/u);
  }
});

test("diagnostics have a separate fixed bound even for huge invalid options", async () => {
  const result = await run("diff", ["--" + "☃".repeat(5000)]);
  assert.equal(result.exitCode, 2);
  assert(Buffer.byteLength(result.stderr) <= 4096);
  assert.match(result.stderr, /…\n$/u);
});

test("patch updates preserve existing permission bits", async () => {
  const fs = await filesystem({ target: "old\n" });
  await fs.chmod("/work/target", 0o755);
  const result = await run("patch", [], { fs, input: replacement });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.stat("/work/target")).mode & 0o777, 0o755);
});
