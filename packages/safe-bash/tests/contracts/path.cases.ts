import assert from "node:assert/strict";
import test from "node:test";
import { posix } from "node:path";
import { posixPath as canonicalPortablePath } from "poe-code/safe-fs/core";
import {
  assertPathWithin, basename, dirname, extname, isAbsolutePath, isFsError,
  isPathWithin, joinPath, normalizePath, posixPath as portablePath, relativePath, resolvePath,
} from "../../src/contracts/index.js";

test("normalization uses virtual absolute POSIX paths, not the host cwd", () => {
  assert.equal(normalizePath("file"), "/file");
  assert.equal(normalizePath("../file", "/work/nested"), "/work/file");
  assert.equal(normalizePath("//work///./file/../"), "/work");
  assert.equal(normalizePath("../../etc", "/"), "/etc");
  assert.equal(normalizePath(""), "/");
  assert.equal(normalizePath("a\\b", "/work"), "/work/a\\b");
  assert.equal(resolvePath("/work", "child", "/other", "file"), "/other/file");
});

test("invalid cwd and NUL bytes report EINVAL", () => {
  assert.throws(() => normalizePath("file", "relative"), (error) => isFsError(error, "EINVAL"));
  assert.throws(() => normalizePath("/bad\0path"), (error) => isFsError(error, "EINVAL"));
  assert.throws(() => resolvePath("/bad\0cwd", "/safe"), (error) => isFsError(error, "EINVAL"));
});

test("lexical containment checks path components rather than string prefixes", () => {
  assert.ok(isPathWithin("/root", "/root"));
  assert.ok(isPathWithin("/root/", "/root/nested/file"));
  assert.ok(isPathWithin("/", "/anything"));
  assert.equal(isPathWithin("/root", "/root-other"), false);
  assert.equal(isPathWithin("/root", "/root/../secret"), false);
  assert.equal(assertPathWithin("/root", "/root/./child"), "/root/child");
  assert.throws(() => assertPathWithin("/root", "/secret"), (error) => isFsError(error, "EACCES"));
});

test("POSIX helpers remain available without platform-specific separators", async () => {
  assert.equal(joinPath("/a", "b", "../c"), "/a/c");
  assert.equal(dirname("/a/file.txt"), "/a");
  assert.equal(basename("/a/file.txt"), "file.txt");
  assert.equal(extname("/a/file.txt"), ".txt");
  assert.equal(relativePath("/a", "/b/file"), "../b/file");
  assert.ok(isAbsolutePath("/a"));
  const { posixPath } = await import("../../src/contracts/node.js");
  assert.equal(posixPath.sep, "/");
  assert.equal(posixPath.delimiter, ":");
  assert.equal(posixPath.normalize("/a/../b"), "/b");
  assert.equal(posixPath.resolve("/a", "../b"), "/b");
  assert.equal(posixPath.relative("/a", "/b"), "../b");
  assert.equal(posixPath.format(posixPath.parse("/a/file.txt")), "/a/file.txt");
});

test("internal path helpers share the canonical portable POSIX object", () => {
  assert.equal(portablePath, canonicalPortablePath);
  assert.equal(portablePath.join("/a", "..", "b"), "/b");
});

test("Node contract entries and the root preserve native POSIX identity", async () => {
  const [contracts, paths, root] = await Promise.all([
    import("../../src/contracts/node.js"),
    import("../../src/contracts/node-path.js"),
    import("../../src/index.js"),
  ]);
  for (const entry of [contracts, paths, root]) assert.equal(entry.posixPath, posix);
  assert.equal(paths.normalizePath, normalizePath);
  assert.equal(contracts.normalizePath, normalizePath);
  assert.deepEqual(Object.keys(paths).sort(), [
    "assertPathWithin", "basename", "dirname", "extname", "isAbsolutePath", "isPathWithin",
    "joinPath", "normalizePath", "posixPath", "relativePath", "resolvePath", "validatePath",
  ]);
});
