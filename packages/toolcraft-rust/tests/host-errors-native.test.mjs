import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { callNative, protect } from "../dist/host-errors.js";

const native = createRequire(import.meta.url)("../dist/toolcraft-rust.node");

test("host exception carriers do not traverse inherited error causes", () => {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "cause");
  const cause = {};
  const failure = Symbol("original failure");
  const host = {
    get: protect(() => { throw failure; }),
    operate: protect(() => { throw failure; })
  };
  try {
    Object.defineProperty(Object.prototype, "cause", { configurable: true, value: cause });
    assert.throws(() => callNative(native.cliArgvPolicy, "invalid", [], host), value => value === failure);
  } finally {
    if (original) Object.defineProperty(Object.prototype, "cause", original);
    else delete Object.prototype.cause;
  }
});

test("host exception carriers do not evaluate inherited cause getters", () => {
  const original = Object.getOwnPropertyDescriptor(Error.prototype, "cause");
  const failure = Object.freeze({ toString() { throw new Error("must not coerce"); } });
  let reads = 0;
  const host = {
    get: protect(() => { throw failure; }),
    operate: protect(() => { throw failure; })
  };
  try {
    Object.defineProperty(Error.prototype, "cause", {
      configurable: true,
      get() { reads++; throw new Error("must not read"); }
    });
    assert.throws(() => callNative(native.cliArgvPolicy, "invalid", [], host), value => value === failure);
  } finally {
    if (original) Object.defineProperty(Error.prototype, "cause", original);
    else delete Error.prototype.cause;
  }
  assert.equal(reads, 0);
});
