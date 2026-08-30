import assert from "node:assert/strict";
import test from "node:test";
import { fixture, run } from "./helpers.js";

test("mkdir creates parents and octal modes, reports errors without abandoning other operands", async () => {
  const fs = await fixture({ collision: "data" });
  assert.equal((await run("mkdir", ["-p", "-m", "700", "nested/child"], { fs })).exitCode, 0);
  assert.equal((await fs.stat("/work/nested/child")).mode & 0o777, 0o700);
  const result = await run("mkdir", ["collision", "other"], { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EEXIST/u);
  assert.equal((await fs.stat("/work/other")).type, "directory");
  assert.equal((await run("mkdir", ["-m", "invalid", "bad"], { fs })).exitCode, 2);
});

test("touch creates without truncation, honors no-create and reference access/modify times", async () => {
  const fs = await fixture({ source: "keep", reference: "ref" });
  await fs.utimes("/work/reference", 123, 456);
  await fs.utimes("/work/source", 11, 22);
  assert.equal((await run("touch", ["-ar", "reference", "source"], { fs })).exitCode, 0);
  const stat = await fs.stat("/work/source");
  assert.equal(stat.atimeMs, 123);
  assert.equal(stat.mtimeMs, 22);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/source")), "keep");
  await run("touch", ["-c", "absent"], { fs });
  await assert.rejects(fs.stat("/work/absent"), { code: "ENOENT" });
  await run("touch", ["new"], { fs });
  assert.equal((await fs.stat("/work/new")).size, 0);
});

test("cp handles multiple files, no-clobber and same-inode protection", async () => {
  const fs = await fixture({ first: "one", second: "two", target: "keep" });
  await run("mkdir", ["out"], { fs });
  assert.equal((await run("cp", ["first", "second", "out"], { fs })).exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/out/second")), "two");
  await run("cp", ["-n", "first", "target"], { fs });
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/target")), "keep");
  await fs.link("/work/first", "/work/alias");
  assert.match((await run("cp", ["first", "alias"], { fs })).stderr, /same file/u);
  assert.equal((await run("cp", ["first", "second", "missing-dir"], { fs })).exitCode, 1);
});

test("cp recursively copies trees, preserves nested symlinks and rejects self-descendants", async () => {
  const fs = await fixture({ "source/deep/file": "payload" });
  await fs.symlink("deep/file", "/work/source/link");
  assert.equal((await run("cp", ["-R", "source", "destination"], { fs })).exitCode, 0);
  assert.equal(await fs.readlink("/work/destination/link"), "deep/file");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/destination/deep/file")), "payload");
  assert.equal((await run("cp", ["source", "other"], { fs })).exitCode, 1);
  assert.match((await run("cp", ["-R", "source", "source/inside"], { fs })).stderr, /into itself/u);
  await fs.symlink("source", "/work/alias");
  assert.match((await run("cp", ["-R", "source", "alias/inside"], { fs })).stderr, /into itself/u);
  await fs.symlink(".", "/work/source/loop");
  assert.match((await run("cp", ["-RL", "source", "followed"], { fs })).stderr, /ELOOP/u);
});

test("mv renames and honors no-clobber without host filesystem operations", async () => {
  const fs = await fixture({ first: "one", second: "two" });
  await run("mv", ["-n", "first", "second"], { fs });
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/second")), "two");
  assert.equal((await run("mv", ["first", "renamed"], { fs })).exitCode, 0);
  await assert.rejects(fs.stat("/work/first"), { code: "ENOENT" });
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/renamed")), "one");
});

test("rm refuses directories by default, protects root, removes links not targets, and supports force", async () => {
  const fs = await fixture({ "directory/file": "keep" });
  await fs.symlink("directory", "/work/link");
  assert.equal((await run("rm", ["directory"], { fs })).exitCode, 1);
  assert.equal((await run("rm", ["link"], { fs })).exitCode, 0);
  assert.equal((await fs.stat("/work/directory/file")).type, "file");
  assert.equal((await run("rm", ["-rf", "/"], { fs })).exitCode, 1);
  assert.equal((await run("rm", ["-rf", "."], { fs })).exitCode, 1);
  assert.equal((await run("rm", ["-f", "missing"], { fs })).exitCode, 0);
  assert.equal((await run("rm", ["-r", "directory"], { fs })).exitCode, 0);
  await assert.rejects(fs.stat("/work/directory"), { code: "ENOENT" });
});

test("rmdir checks directory type and emptiness and supports parent removal", async () => {
  const fs = await fixture({ file: "x", "nonempty/file": "x" });
  assert.match((await run("rmdir", ["file"], { fs })).stderr, /ENOTDIR/u);
  assert.match((await run("rmdir", ["nonempty"], { fs })).stderr, /ENOTEMPTY/u);
  await fs.mkdir("/work/parents/child", { recursive: true });
  assert.equal((await run("rmdir", ["-p", "parents/child"], { fs })).exitCode, 0);
  await assert.rejects(fs.stat("/work/parents"), { code: "ENOENT" });
  assert.equal((await fs.stat("/work")).type, "directory");
});

test("ln supports hardlinks and literal relative symbolic targets, replacement and target directories", async () => {
  const fs = await fixture({ source: "data" });
  await fs.mkdir("/work/out");
  assert.equal((await run("ln", ["source", "hard"], { fs })).exitCode, 0);
  assert.equal((await fs.stat("/work/hard")).ino, (await fs.stat("/work/source")).ino);
  assert.equal((await run("ln", ["-s", "../source", "out/symbolic"], { fs })).exitCode, 0);
  assert.equal(await fs.readlink("/work/out/symbolic"), "../source");
  assert.equal((await run("ln", ["-sf", "missing", "out/symbolic"], { fs })).exitCode, 0);
  assert.equal(await fs.readlink("/work/out/symbolic"), "missing");
  assert.equal((await run("ln", ["source", "out"], { fs })).exitCode, 0);
  assert.equal((await run("ln", ["-f", "missing", "source"], { fs })).exitCode, 1);
  assert.equal((await fs.stat("/work/source")).size, 4);
});

test("readlink and realpath distinguish literal targets, existing and missing paths", async () => {
  const fs = await fixture({ file: "x" });
  await fs.symlink("file", "/work/link");
  assert.equal((await run("readlink", ["-n", "link"], { fs })).stdout, "file");
  assert.equal((await run("readlink", ["-f", "link"], { fs })).stdout, "/work/file\n");
  assert.equal((await run("readlink", ["file"], { fs })).exitCode, 1);
  assert.equal((await run("realpath", ["missing"], { fs })).stdout, "/work/missing\n");
  assert.equal((await run("realpath", ["-e", "missing"], { fs })).exitCode, 1);
  assert.equal((await run("realpath", ["-mz", "absent/deep/file"], { fs })).stdout, "/work/absent/deep/file\0");
  await fs.mkdir("/work/deep/inside", { recursive: true });
  await fs.symlink("deep/inside", "/work/directory-link");
  assert.equal((await run("realpath", ["directory-link/.."], { fs })).stdout, "/work/deep\n");
  assert.match((await run("realpath", ["file/.."], { fs })).stderr, /ENOTDIR/u);
});

test("ls implements hidden names, classification, explicit directories, recursion and long records", async () => {
  const fs = await fixture({ zebra: "z", alpha: "a", ".hidden": "h", "nested/file": "x" });
  await fs.symlink("alpha", "/work/link");
  assert.equal((await run("ls", [], { fs })).stdout, "alpha\nlink\nnested\nzebra\n");
  assert.equal((await run("ls", ["-AF"], { fs })).stdout, ".hidden\nalpha\nlink@\nnested/\nzebra\n");
  assert.equal((await run("ls", ["-d", "nested"], { fs })).stdout, "nested\n");
  assert.match((await run("ls", ["-a"], { fs })).stdout, /^\.\n\.\.\n\.hidden\n/u);
  assert.match((await run("ls", ["-R", "nested"], { fs })).stdout, /^nested:\nfile\n$/u);
  assert.match((await run("ls", ["-l", "link"], { fs })).stdout, /^lrwxrwxrwx .* link -> alpha\n$/u);
  assert.equal((await run("ls", ["--made-up"], { fs })).exitCode, 2);
});
