import assert from "node:assert/strict";
import test from "node:test";
import { binary, fixed, round } from "./numeric.js";
import { emitPadded } from "./padding.js";
import { fields, unit } from "./selection.js";

test("numeric boundary preserves precision beyond safe integers and signed rounding", () => {
  assert.equal(fixed(binary(9007199254740993n), 0), "9007199254740993");
  assert.equal(fixed(round(binary(-5n, 2n), "from-zero"), 0), "-3");
});

test("selection boundary merges ranges and bounds units and allocation", () => {
  assert.deepEqual(fields("3-5,1-3", false, 2), [[1n, 5n]]);
  assert.throws(() => fields("1,2", false, 1), /field range limit exceeded/);
  assert.equal(unit("2Ki", false), 2048n);
  assert.throws(() => unit("18446744073709551616", false), /invalid unit size/);
});

for (const left of [false, true]) test(`padding boundary awaits bounded writes (left=${left})`, async () => {
  const chunks: string[] = [];
  let writing = false;
  await emitPadded({ padding: 2050n, left, unicode: false }, { async emit(text) {
    assert.equal(writing, false);
    writing = true;
    await Promise.resolve();
    assert.ok(text.length <= 1024);
    chunks.push(text);
    writing = false;
  } }, "1");
  assert.equal(chunks.join(""), left ? "1" + " ".repeat(2049) : " ".repeat(2049) + "1");
});
