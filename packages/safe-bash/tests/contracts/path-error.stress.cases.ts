import assert from "node:assert/strict";
import test from "node:test";
import {
  FsError, assertPathWithin, isFsError, isPathWithin, normalizePath, relativePath, toFsError,
  type ErrnoCode,
} from "../../src/contracts/index.js";

test("relative paths are resolved in virtual root rather than leaking the host cwd", () => {
  assert.equal(relativePath("/", "child"), "child");
  assert.equal(relativePath("child", "/"), "..");
  assert.equal(relativePath("one", "two"), "../two");
  assert.throws(() => relativePath("/", "bad\0path"), (error) => isFsError(error, "EINVAL"));
});

test("traversal and prefix lookalikes never pass lexical containment", () => {
  for (const path of ["/root/../secret", "/root/child/../../secret", "/root-other/file",
    "/rootish", "///root//..//secret", "/ROOT/file"]) {
    assert.equal(isPathWithin("/root", path), false, path);
    assert.throws(() => assertPathWithin("/root", path), (error) => isFsError(error, "EACCES"));
  }
  for (const path of ["/root", "/root/./file", "/root/nested/../file", "/root/%2e%2e/file",
    "/root/..\\secret", "/root/…/file"]) assert.ok(isPathWithin("/root", path), path);
});

test("normalization is idempotent across a generated traversal corpus", () => {
  const segments = [".", "..", "", "file", "space name", "é", "\\"];
  for (const first of segments) {
    for (const second of segments) {
      for (const third of segments) {
        const path = `/root/${first}/${second}/${third}`;
        const normalized = normalizePath(path);
        assert.equal(normalizePath(normalized), normalized);
        assert.equal(isPathWithin("/root", path), isPathWithin("/root", normalized));
      }
    }
  }
});

test("invalid runtime errno codes cannot manufacture NaN errno metadata", () => {
  for (const code of ["BOGUS", "__proto__", "", null]) {
    assert.throws(() => new FsError(code as ErrnoCode), TypeError);
  }
});

test("explicit error-normalization overrides work for existing FsError instances", () => {
  const original = new FsError("EACCES", { syscall: "open", path: "/host/private/file" });
  const safe = toFsError(original, { syscall: "readFile", path: "/file" });
  assert.notEqual(safe, original);
  assert.equal(safe.code, "EACCES");
  assert.equal(safe.path, "/file");
  assert.equal(safe.syscall, "readFile");
  assert.equal(safe.cause, original);
  assert.equal(safe.message.includes("/host/private"), false);
  assert.equal(toFsError(original), original);
});

test("error normalization drops wrong-shaped metadata without losing the cause", () => {
  const original = { code: "ENOENT", path: 123, dest: {}, syscall: false };
  const result = toFsError(original);
  assert.equal(result.code, "ENOENT");
  assert.equal(result.path, undefined);
  assert.equal(result.dest, undefined);
  assert.equal(result.syscall, undefined);
  assert.equal(result.cause, original);
});
