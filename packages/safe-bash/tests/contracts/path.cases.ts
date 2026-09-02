import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPathWithin, basename, dirname, extname, isAbsolutePath, isFsError,
  isPathWithin, joinPath, normalizePath, posixPath, relativePath, resolvePath,
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

test("POSIX helpers remain available without platform-specific separators", () => {
  assert.equal(joinPath("/a", "b", "../c"), "/a/c");
  assert.equal(dirname("/a/file.txt"), "/a");
  assert.equal(basename("/a/file.txt"), "file.txt");
  assert.equal(extname("/a/file.txt"), ".txt");
  assert.equal(relativePath("/a", "/b/file"), "../b/file");
  assert.ok(isAbsolutePath("/a"));
  assert.equal(posixPath.sep, "/");
});
