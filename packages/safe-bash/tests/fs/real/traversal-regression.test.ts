import assert from "node:assert/strict";
import * as native from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { inspect } from "node:util";
import { collectBytes } from "../../../src/contracts/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import type { RealFileSystem } from "../../../src/fs/real/index.js";
import { bytes, errno, fixture, text } from "./helpers.js";

test("verifier: operation paths follow a symlink before dot-dot for reads and writes", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.mkdir("/a/b", { recursive: true });
  await filesystem.writeFile("/a/x", bytes("RIGHT"));
  await filesystem.writeFile("/x", bytes("WRONG"));
  await filesystem.symlink("/a/b", "/link");
  assert.equal(text(await filesystem.readFile("/link/../x")), "RIGHT");
  assert.equal(await filesystem.realpath("/link/../x"), "/a/x");
  await filesystem.writeFile("/link/../x", bytes("CHANGED"));
  assert.equal(text(await filesystem.readFile("/a/x")), "CHANGED");
  assert.equal(text(await filesystem.readFile("/x")), "WRONG");
  await filesystem.rename("/link/../x", "/link/../renamed");
  assert.equal(text(await filesystem.readFile("/a/renamed")), "CHANGED");
  await filesystem.rm("/link/../renamed");
  assert.equal(text(await filesystem.readFile("/x")), "WRONG");
});

test("verifier: dot, dot-dot, and trailing slash require traversable existing prefixes", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.writeFile("/file", bytes("safe"));
  for (const path of ["/file/..", "/file/", "/file/.", "/file//", "/file/../missing"]) {
    await assert.rejects(filesystem.stat(path), errno("ENOTDIR", path, "stat"));
    await assert.rejects(filesystem.lstat(path), errno("ENOTDIR"));
    await assert.rejects(filesystem.realpath(path), errno("ENOTDIR"));
  }
  for (const path of ["/missing/..", "/missing/.", "/missing/../file"]) {
    await assert.rejects(filesystem.stat(path), errno("ENOENT"));
    await assert.rejects(filesystem.writeFile(path, bytes("bad")), errno("ENOENT"));
  }
  assert.equal(text(await filesystem.readFile("/file")), "safe");
});

test("verifier: trailing slash never lets rm delete a regular file", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.writeFile("/file", bytes("safe"));
  for (const recursive of [false, true]) {
    for (const force of [false, true]) {
      await assert.rejects(filesystem.rm("/file/", { recursive, force }), errno("ENOTDIR"));
      assert.equal(text(await filesystem.readFile("/file")), "safe");
    }
  }
});

test("verifier: empty paths reject instead of silently referring to the root", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.writeFile("safe", bytes("safe"));
  const operations = [
    () => filesystem.realpath(""), () => filesystem.stat(""), () => filesystem.lstat(""),
    () => filesystem.readdir(""), () => filesystem.readFile(""), () => filesystem.access(""),
    () => filesystem.writeFile("", bytes("bad")), () => filesystem.appendFile("", bytes("bad")),
    () => filesystem.mkdir(""), () => filesystem.mkdir("", { recursive: true }),
    () => filesystem.rm(""), () => filesystem.rename("", "new"), () => filesystem.rename("safe", ""),
    () => filesystem.copyFile("safe", ""), () => filesystem.copyFile("", "new"),
    () => filesystem.symlink("safe", ""), () => filesystem.readlink(""),
    () => filesystem.link("safe", ""), () => filesystem.truncate(""),
    () => collectBytes(filesystem.readStream(""), { maxBytes: 100 }),
  ];
  for (const operation of operations) await assert.rejects(operation(), errno("ENOENT"));
  assert.equal(text(await filesystem.readFile("safe")), "safe");
});

for (const suffix of [".", "./", "././", "child/..", "child/..//"]) {
  test(`verifier: destructive terminal ${suffix} operands preserve directories and content`, async (context) => {
    const { filesystem } = await fixture(context);
    await filesystem.mkdir("/dir/child", { recursive: true });
    await filesystem.mkdir("/other");
    await filesystem.writeFile("/dir/sentinel", bytes("keep"));
    await filesystem.writeFile("/dir/child/sentinel", bytes("child-keep"));
    const path = `/dir/${suffix}`;
    await assert.rejects(filesystem.rm(path, { recursive: true }), errno("EINVAL"));
    await assert.rejects(filesystem.rename(path, "/moved"), errno("EINVAL"));
    await assert.rejects(filesystem.rename("/other", path), errno("EINVAL"));
    assert.equal(text(await filesystem.readFile("/dir/sentinel")), "keep");
    assert.equal(text(await filesystem.readFile("/dir/child/sentinel")), "child-keep");
    assert.equal((await filesystem.stat("/other")).type, "directory");
  });
}

test("invalid prefixes retain their errno before destructive terminal validation", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.writeFile("file", bytes("safe"));
  for (const terminal of [".", ".."]) {
    await assert.rejects(filesystem.rm(`/file/${terminal}`, { recursive: true }), errno("ENOTDIR"));
    await assert.rejects(filesystem.rename(`/file/${terminal}`, "/other"), errno("ENOTDIR"));
    await assert.rejects(filesystem.rm(`/missing/${terminal}`, { recursive: true }), errno("ENOENT"));
  }
  assert.equal(text(await filesystem.readFile("file")), "safe");
});

test("verifier: absolute symlink targets retain their raw components and resolve before dot-dot", async (context) => {
  const { filesystem, root } = await fixture(context);
  await filesystem.mkdir("/a/b", { recursive: true });
  await filesystem.writeFile("/a/x", bytes("RIGHT"));
  await filesystem.writeFile("/x", bytes("WRONG"));
  await filesystem.symlink("/a/b", "/link");
  for (const [index, target] of ["/link/../x", "//link///.././x"].entries()) {
    const alias = `/alias-${index}`;
    await filesystem.symlink(target, alias);
    assert.equal(await filesystem.readlink(alias), target);
    assert.equal(await native.readlink(`${root}${alias}`), `${root}${target}`);
    assert.equal(text(await filesystem.readFile(alias)), "RIGHT");
  }
  await filesystem.symlink("/a/x/", "/file-with-slash");
  await assert.rejects(filesystem.stat("/file-with-slash"), errno("ENOTDIR"));
});

test("verifier: safe nontraversable symlink targets can be created without resolving them", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.writeFile("/file", bytes("safe"));
  for (const [index, target] of ["/file/child", "file/child", "/file/../missing"].entries()) {
    const alias = `/alias-${index}`;
    await filesystem.symlink(target, alias);
    assert.equal(await filesystem.readlink(alias), target);
    assert.equal((await filesystem.lstat(alias)).type, "symlink");
    await assert.rejects(filesystem.stat(alias), errno("ENOTDIR"));
  }
  await filesystem.symlink("/missing/../file", "/missing-prefix");
  await assert.rejects(filesystem.stat("/missing-prefix"), errno("ENOENT"));
  await filesystem.symlink("loop", "loop");
  await filesystem.symlink("/loop", "loop-alias");
  await assert.rejects(filesystem.stat("loop-alias"), errno("ELOOP"));
  await assert.rejects(filesystem.symlink("/file/../../outside", "/escape"), errno("EACCES"));
  assert.equal(text(await filesystem.readFile("/file")), "safe");
});

test("verifier: missing trailing-slash destinations accept directories but never files", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.mkdir("/directory");
  await filesystem.writeFile("/directory/sentinel", bytes("keep"));
  await filesystem.rename("/directory", "/newdirectory/");
  assert.equal(text(await filesystem.readFile("/newdirectory/sentinel")), "keep");
  await filesystem.rename("/newdirectory/", "/again//");
  assert.equal(text(await filesystem.readFile("/again/sentinel")), "keep");
  await filesystem.writeFile("/file", bytes("safe"));
  await assert.rejects(filesystem.rename("/file", "/newfile/"));
  await assert.rejects(filesystem.writeFile("/newfile/", bytes("bad")));
  await assert.rejects(filesystem.symlink("/file", "/newlink/"));
  assert.equal(text(await filesystem.readFile("/file")), "safe");
  await assert.rejects(filesystem.stat("/newfile"), errno("ENOENT"));
  await assert.rejects(filesystem.stat("/newlink"), errno("ENOENT"));
});

test("trailing directory requirements follow final symlinks, unlike ordinary lstat and rm", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.mkdir("/directory");
  await filesystem.writeFile("/directory/file", bytes("safe"));
  await filesystem.symlink("/directory", "/dirlink");
  assert.equal((await filesystem.lstat("/dirlink")).type, "symlink");
  assert.equal((await filesystem.lstat("/dirlink/")).type, "directory");
  assert.equal((await filesystem.lstat("/dirlink/.")).type, "directory");
  await assert.rejects(filesystem.readlink("/dirlink/"), errno("EINVAL"));
  await filesystem.rm("/dirlink/", { recursive: true });
  assert.equal((await filesystem.lstat("/dirlink")).type, "symlink");
  await assert.rejects(filesystem.stat("/directory"), errno("ENOENT"));
});

test("recursive mkdir creates the prefixes actually traversed before dot-dot", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.mkdir("/new/../after", { recursive: true });
  assert.equal((await filesystem.stat("/new")).type, "directory");
  assert.equal((await filesystem.stat("/after")).type, "directory");
  await filesystem.mkdir("/another/.", { recursive: true });
  assert.equal((await filesystem.stat("/another")).type, "directory");
  await assert.rejects(filesystem.mkdir("/absent/."), errno("ENOENT"));
  await assert.rejects(filesystem.stat("/absent"), errno("ENOENT"));
  await filesystem.symlink("/target", "/dangling");
  await assert.rejects(filesystem.mkdir("/dangling", { recursive: true }), errno("ENOENT"));
  await assert.rejects(filesystem.mkdir("/dangling/child", { recursive: true }), errno("ENOENT"));
  await assert.rejects(filesystem.stat("/target"), errno("ENOENT"));
});

test("configured root resolution preserves symlink-before-dot-dot semantics", async (context) => {
  const { temporary } = await fixture(context);
  await native.mkdir(`${temporary}/actual/deep`, { recursive: true });
  await native.symlink("actual/deep", `${temporary}/root-alias`);
  const filesystem = await createRealFileSystem(`${temporary}/root-alias/..`);
  await filesystem.writeFile("sentinel", bytes("actual-root"));
  assert.equal(await native.readFile(`${temporary}/actual/sentinel`, "utf8"), "actual-root");
  await assert.rejects(native.stat(`${temporary}/sentinel`), { code: "ENOENT" });
});

test("verifier: public errors omit native host paths throughout inspection and cause chains", async (context) => {
  const { filesystem, root, temporary } = await fixture(context);
  await filesystem.mkdir("dir");
  await filesystem.writeFile("file", bytes("safe"));
  const operations = [
    () => filesystem.stat("/absent"),
    () => filesystem.rename("/absent", "/destination"),
    () => filesystem.rename("/file", "/missing/destination"),
    () => filesystem.copyFile("/absent", "/destination"),
    () => filesystem.rm("/dir"),
    () => filesystem.writeFile("/missing/file", bytes("bad")),
    () => collectBytes(filesystem.readStream("/absent"), { maxBytes: 100 }),
    () => filesystem.writeStream("file", (async function* () {
      yield bytes("prefix");
      await native.stat(`${root}/native-source-error`);
    })()),
    () => createRealFileSystem(`${temporary}/missing-root`),
  ];
  for (const operation of operations) {
    await assert.rejects(operation(), (error: unknown) => {
      const exposed = inspect(error, { depth: null, showHidden: true });
      assert.equal(exposed.includes(root), false, exposed);
      assert.equal(exposed.includes(temporary), false, exposed);
      assert.equal((error as Error).cause, undefined);
      assert.equal(JSON.stringify(error).includes(temporary), false);
      return true;
    });
  }
});

async function result(action: () => Promise<unknown>): Promise<unknown> {
  try {
    const value = await action();
    return value instanceof Uint8Array ? { bytes: [...value] } : { value };
  } catch (error) {
    const failure = error as { code: string; info?: { code?: string } };
    return { code: failure.info?.code ?? failure.code };
  }
}

test("140 raw-path read operations match an independently populated native tree", async (context) => {
  const { filesystem, root, temporary } = await fixture(context);
  const oracle = join(temporary, "oracle");
  for (const directory of [root, oracle]) {
    await native.mkdir(`${directory}/a/b`, { recursive: true });
    await native.writeFile(`${directory}/a/x`, "RIGHT");
    await native.writeFile(`${directory}/x`, "WRONG");
    await native.writeFile(`${directory}/file`, "FILE");
    await native.symlink("a/b", `${directory}/link`);
    await native.symlink("file", `${directory}/filelink`);
    await native.symlink("missing", `${directory}/dangling`);
    await native.symlink("loop", `${directory}/loop`);
  }
  const paths = [
    "/link/../x", "/file/..", "/file/", "/file/.", "/missing/..", "/missing/.", "/missing/",
    "/a/b/../x", "/link/", "/link/.", "/a///b//../x", "/filelink/", "/dangling/..", "/loop/..",
    "/a/./b/../../x", "/a/x/..", "/a/b/../missing/..", "/file//", "/a/b/", "",
  ];
  for (const path of paths) {
    const host = path === "" ? "" : `${oracle}${path}`;
    const operations: [string, () => Promise<unknown>, () => Promise<unknown>][] = [
      ["stat", async () => (await filesystem.stat(path)).type, async () => (await native.stat(host)).isDirectory() ? "directory" : "file"],
      ["lstat", async () => (await filesystem.lstat(path)).type, async () => {
        const stats = await native.lstat(host);
        return stats.isSymbolicLink() ? "symlink" : stats.isDirectory() ? "directory" : "file";
      }],
      ["readFile", () => filesystem.readFile(path), () => native.readFile(host)],
      ["readStream", () => collectBytes(filesystem.readStream(path), { maxBytes: 100 }), () => native.readFile(host)],
      ["readlink", () => filesystem.readlink(path), () => native.readlink(host)],
      ["access", () => filesystem.access(path), () => native.access(host)],
      ["readdir", async () => (await filesystem.readdir(path)).map((entry) => entry.name).sort(), async () => (await native.readdir(host)).sort()],
    ];
    for (const [name, actual, expected] of operations) {
      assert.deepEqual(await result(actual), await result(expected), `${name}(${JSON.stringify(path)})`);
    }
  }
});

test("dot-dot never cancels an external symlink before containment checks", async (context) => {
  const { filesystem, root, outside } = await fixture(context);
  await filesystem.writeFile("/safe", bytes("inside"));
  await native.symlink(outside, `${root}/escape`);
  const operations = [
    () => filesystem.stat("/escape/../safe"),
    () => filesystem.readFile("/escape/../safe"),
    () => filesystem.writeFile("/escape/../safe", bytes("bad")),
    () => filesystem.rm("/escape/../safe", { recursive: true }),
    () => filesystem.rename("/safe", "/escape/../moved"),
    () => filesystem.copyFile("/safe", "/escape/../copied"),
    () => filesystem.mkdir("/escape/../created", { recursive: true }),
    () => filesystem.symlink("/escape/../safe", "/alias"),
  ];
  for (const operation of operations) await assert.rejects(operation(), errno("EACCES"));
  assert.equal(text(await filesystem.readFile("/safe")), "inside");
  assert.equal(await native.readFile(`${outside}/secret`, "utf8"), "outside-secret");
  assert.deepEqual(await native.readdir(outside), ["secret"]);
});

async function snapshot(root: string): Promise<unknown[]> {
  const entries: unknown[] = [];
  for (const name of (await native.readdir(root)).sort()) {
    const path = `${root}/${name}`;
    const stats = await native.lstat(path);
    if (stats.isSymbolicLink()) entries.push([name, "symlink", await native.readlink(path)]);
    else if (stats.isDirectory()) entries.push([name, "directory", await snapshot(path)]);
    else entries.push([name, "file", [...await native.readFile(path)]]);
  }
  return entries;
}

test("80 raw-path mutations match native outcomes and complete tree snapshots", async (context) => {
  const { temporary } = await fixture(context);
  const operations: [string,
    (filesystem: RealFileSystem, path: string) => Promise<unknown>,
    (root: string, path: string) => Promise<unknown>,
  ][] = [
    ["write", (filesystem, path) => filesystem.writeFile(path, bytes("changed")), (root, path) => native.writeFile(`${root}${path}`, "changed")],
    ["append", (filesystem, path) => filesystem.appendFile(path, bytes("added")), (root, path) => native.appendFile(`${root}${path}`, "added")],
    ["truncate", (filesystem, path) => filesystem.truncate(path, 2), (root, path) => native.truncate(`${root}${path}`, 2)],
    ["mkdir", (filesystem, path) => filesystem.mkdir(path), async (root, path) => { await native.mkdir(`${root}${path}`); }],
    ["mkdir-recursive", (filesystem, path) => filesystem.mkdir(path, { recursive: true }), async (root, path) => { await native.mkdir(`${root}${path}`, { recursive: true }); }],
    ["rm", (filesystem, path) => filesystem.rm(path, { recursive: true }), (root, path) => native.rm(`${root}${path}`, { recursive: true })],
    ["rename-source", (filesystem, path) => filesystem.rename(path, "/moved"), (root, path) => native.rename(`${root}${path}`, `${root}/moved`)],
    ["rename-destination", (filesystem, path) => filesystem.rename("/safe", path), (root, path) => native.rename(`${root}/safe`, `${root}${path}`)],
    ["copy-source", (filesystem, path) => filesystem.copyFile(path, "/copied"), (root, path) => native.copyFile(`${root}${path}`, `${root}/copied`)],
    ["copy-destination", (filesystem, path) => filesystem.copyFile("/safe", path), (root, path) => native.copyFile(`${root}/safe`, `${root}${path}`)],
  ];
  const paths = ["/file/", "/file/..", "/file/.", "/missing/../after", "/missing/.", "/missing/", "/link/../x", "/link/../new"];
  let index = 0;
  for (const path of paths) {
    for (const [name, actual, expected] of operations) {
      const root = `${temporary}/case-${index++}`;
      const oracle = `${root}-oracle`;
      for (const directory of [root, oracle]) {
        await native.mkdir(`${directory}/a/b`, { recursive: true });
        await native.writeFile(`${directory}/a/x`, "RIGHT");
        await native.writeFile(`${directory}/x`, "WRONG");
        await native.writeFile(`${directory}/safe`, "SAFE");
        await native.writeFile(`${directory}/file`, "FILE");
        await native.symlink("a/b", `${directory}/link`);
      }
      const filesystem = await createRealFileSystem(root);
      const label = `${name}(${path})`;
      assert.deepEqual(await result(() => actual(filesystem, path)), await result(() => expected(oracle, path)), label);
      assert.deepEqual(await snapshot(root), await snapshot(oracle), `${label} side effects`);
    }
  }
});
