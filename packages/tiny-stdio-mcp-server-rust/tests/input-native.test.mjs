import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const { NativeServer } = createRequire(import.meta.url)("../dist/tiny-stdio-mcp-server-rust.node");

test("primitive returns do not access object descriptor machinery", () => {
  const native = new NativeServer({ name: "test", version: "0" });
  const descriptor = Reflect.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor");
  let effects = 0;
  const results = [];
  Object.defineProperty(Object, "getOwnPropertyDescriptor", {
    configurable: true,
    get() {
      effects++;
      return descriptor.value;
    }
  });
  try {
    for (const value of [undefined, null, true, 12, "hello\ud800", NaN]) {
      results.push(native.normalizeResult(value, false));
    }
  } finally {
    Object.defineProperty(Object, "getOwnPropertyDescriptor", descriptor);
  }
  assert.equal(effects, 0);
  assert.deepEqual(
    results.map((result) => result.content.map((block) => block.text)),
    [[], ["null"], ["true"], ["12"], ["hello\ud800"], ["NaN"]]
  );
});
