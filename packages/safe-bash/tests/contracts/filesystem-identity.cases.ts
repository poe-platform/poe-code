import assert from "node:assert/strict";
import test from "node:test";
import type { FileStat } from "../../src/contracts/index.js";

type Same<Actual, Expected> =
  (<Value>() => Value extends Actual ? 1 : 2) extends
  (<Value>() => Value extends Expected ? 1 : 2) ? true : false;

const legacy: Omit<FileStat, "identityScope"> = {
  type: "file", size: 7, mode: 0o100644, atimeMs: 0, mtimeMs: 0, ctimeMs: 0,
};

test("FileStat identity scope is optional and opaque, preserving legacy structural compatibility", () => {
  const stat: FileStat = legacy;
  const signature: Same<FileStat["identityScope"], object | symbol | undefined> = true;
  assert.equal(signature, true);
  assert.equal(stat.identityScope, undefined);
  assert.equal(stat.dev, undefined);
  assert.equal(stat.ino, undefined);
});

test("stat forwarding preserves object scope by reference without coercion", () => {
  const scope = Object.freeze({
    toString() { throw new Error("identity must not stringify"); },
    toJSON() { throw new Error("identity must not serialize"); },
    [Symbol.toPrimitive]() { throw new Error("identity must not coerce"); },
  });
  const stat: FileStat = { ...legacy, identityScope: scope, dev: 0, ino: 12 };
  const forwarded: FileStat = { ...stat, mode: 0o100400 };
  assert.equal(forwarded.identityScope, scope);
  assert.equal(forwarded.dev, stat.dev);
  assert.equal(forwarded.ino, stat.ino);
  assert.notEqual(forwarded.identityScope, Object.freeze({}));
});

test("symbol descriptions are not identity while the native convention shares a token", () => {
  const first: FileStat = { ...legacy, identityScope: Symbol("same description"), dev: 3, ino: 7 };
  const second: FileStat = { ...legacy, identityScope: Symbol("same description"), dev: 3, ino: 7 };
  assert.notEqual(first.identityScope, second.identityScope);
  const native: FileStat = { ...legacy, identityScope: Symbol.for("virtual-bash.fs.native"), dev: 3, ino: 7 };
  assert.equal({ ...native }.identityScope, Symbol.for("virtual-bash.fs.native"));
});

test("partial identity metadata remains representable and is not a complete proof", () => {
  const partial: FileStat = { ...legacy, identityScope: Symbol(), dev: 1 };
  const unscoped: FileStat = { ...legacy, dev: 1, ino: 2 };
  assert.equal(partial.ino, undefined);
  assert.equal(unscoped.identityScope, undefined);
});
