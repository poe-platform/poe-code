import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalizeJson } from "../dist/index.js";

test("native JSON number spelling follows ECMAScript notation boundaries and extreme binary64 values", () => {
  const values = [
    0,
    -0,
    1e-7,
    1e-6,
    1e-5,
    1e20,
    1e21,
    1e22,
    1.2345678901234568e21,
    1.2345678901234568e-7,
    Number.MIN_VALUE,
    Number.MAX_VALUE,
    2.2250738585072014e-308,
    2.225073858507201e-308,
    1000000000000000128,
    Number("333333333.33333329")
  ];
  for (const value of values.flatMap((value) => [value, -value])) {
    const expected = JSON.stringify(value);
    assert.equal(canonicalizeJson(expected), expected, `${value}`);
  }
});

test("native JSON serialization agrees with V8 for deterministic binary64 bit patterns", () => {
  const view = new DataView(new ArrayBuffer(8));
  const values = [];
  let bits = 0x3141592653589793n;
  for (let index = 0; index < 32768; index++) {
    bits = BigInt.asUintN(64, bits ^ (bits << 13n));
    bits = BigInt.asUintN(64, bits ^ (bits >> 7n));
    bits = BigInt.asUintN(64, bits ^ (bits << 17n));
    view.setBigUint64(0, bits);
    const value = view.getFloat64(0);
    if (Number.isFinite(value)) values.push(value);
  }
  for (const value of [1e-6, 1e21, 1, 1e23, 2.2250738585072014e-308, Number.MAX_VALUE]) {
    view.setFloat64(0, value);
    const boundary = view.getBigUint64(0);
    for (let offset = -32n; offset <= 32n; offset++) {
      view.setBigUint64(0, boundary + offset);
      const number = view.getFloat64(0);
      if (Number.isFinite(number)) values.push(number);
    }
  }
  const expected = JSON.stringify(values);
  const actual = canonicalizeJson(expected);
  if (actual !== expected) {
    const spellings = actual.slice(1, -1).split(",");
    for (let index = 0; index < values.length; index++)
      assert.equal(spellings[index], JSON.stringify(values[index]), `binary64 value ${index}`);
  }
  assert.equal(actual, expected);
});
