import assert from "node:assert/strict";
import test from "node:test";
import { settings } from "./index.js";

test("resource limits are disabled unless configured", () => {
  const defaults = settings();
  for (const [name, value] of Object.entries(defaults)) {
    assert.equal(value, Infinity, name);
    assert.equal(settings({ limits: { [name]: 7 } })[name as keyof typeof defaults], 7);
    assert.equal(settings({ limits: { [name]: Infinity } })[name as keyof typeof defaults], Infinity);
    assert.throws(() => settings({ limits: { [name]: 0 } }), RangeError);
  }
});

test("legacy byte options remain configurable and limits take precedence", () => {
  assert.equal(settings({ maxInputBytes: 7, maxOutputBytes: 9 }).maxInputBytes, 7);
  assert.equal(settings({ maxInputBytes: 7, maxOutputBytes: 9 }).maxOutputBytes, 9);
  assert.equal(settings({ maxInputBytes: 7, limits: { maxInputBytes: 11 } }).maxInputBytes, 11);
});
