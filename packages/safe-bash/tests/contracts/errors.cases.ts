import assert from "node:assert/strict";
import { getSystemErrorMap, getSystemErrorName } from "node:util";
import test from "node:test";
import { FsError, isErrnoCode, isFsError, toFsError } from "../../src/contracts/index.js";

test("FsError exposes standard errno metadata and cause", () => {
  const cause = new Error("backend unavailable");
  const error = new FsError("ENOENT", { syscall: "rename", path: "/before", dest: "/after", cause });
  assert.equal(error.code, "ENOENT");
  assert.equal(getSystemErrorName(error.errno), "ENOENT");
  assert.equal(error.syscall, "rename");
  assert.equal(error.path, "/before");
  assert.equal(error.dest, "/after");
  assert.equal(error.cause, cause);
  assert.equal(error.message, "ENOENT: no such file or directory, rename '/before' -> '/after'");
  assert.ok(error instanceof Error);
});

test("error guards reject inherited keys and arbitrary objects", () => {
  assert.ok(isErrnoCode("ENOTSUP"));
  assert.equal(isErrnoCode("toString"), false);
  assert.equal(isErrnoCode(undefined), false);
  assert.ok(isFsError(new FsError("EACCES"), "EACCES"));
  assert.equal(isFsError(new FsError("EACCES"), "ENOENT"), false);
  assert.equal(isFsError({ code: "EACCES" }), false);
});

test("native errno errors normalize without losing source metadata", () => {
  const native = Object.assign(new Error("native error"), {
    code: "EEXIST", path: "/file", syscall: "open", secret: "not copied",
  });
  const error = toFsError(native);
  assert.equal(error.code, "EEXIST");
  assert.equal(error.path, "/file");
  assert.equal(error.syscall, "open");
  assert.equal(error.cause, native);
  assert.equal("secret" in error, false);
});

test("normalization preserves FsError identity and explicitly overrides native paths", () => {
  const error = new FsError("EROFS");
  assert.equal(toFsError(error), error);
  const native = { code: "EXDEV", path: "/host/private", dest: "/host/other" };
  const normalized = toFsError(native, { path: "/virtual", dest: "/other" });
  assert.equal(normalized.path, "/virtual");
  assert.equal(normalized.dest, "/other");
});

test("unknown failures use EIO and retain the original cause", () => {
  for (const cause of [null, "failure", 42, { code: "HTTP_500" }]) {
    const error = toFsError(cause, { syscall: "readFile" });
    assert.equal(error.code, "EIO");
    assert.equal(error.cause, cause);
  }
});

test("errno values use Node system-error numbers and normalize the EOPNOTSUPP alias", () => {
  const supported = new FsError("ENOTSUP");
  const alias = new FsError("EOPNOTSUPP");
  assert.equal(alias.code, "EOPNOTSUPP");
  assert.equal(alias.errno, supported.errno);
  assert.equal(getSystemErrorName(alias.errno), "ENOTSUP");
  assert.equal(toFsError({ code: "EOPNOTSUPP", errno: -102 }).errno, supported.errno);
  const numbers = new Map([...getSystemErrorMap()].map(([number, [name]]) => [name, number]));
  for (const code of ["EACCES", "ENOENT", "EXDEV", "EPIPE", "ECANCELED"] as const) {
    assert.equal(new FsError(code).errno, numbers.get(code));
  }
});
