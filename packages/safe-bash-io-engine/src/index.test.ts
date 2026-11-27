import assert from "node:assert/strict";
import { test } from "node:test";
import { options } from "./internal.js";
test("long options accept unique prefixes and preserve canonical flag names", () => {
  const parsed = options(["--num", "--rev", "--out=result", "--qui"], "nro:", {
    "numeric-sort": "n", reverse: "r", output: "o", quiet: false,
  });
  assert.deepEqual([...parsed.flags], ["n", "r", "o", "quiet"]);
  assert.deepEqual(parsed.values.get("o"), ["result"]);
});

test("long options prefer exact names and reject ambiguous prefixes", () => {
  const long = { number: "n", "number-nonblank": "b" };
  assert.deepEqual([...options(["--number"], "nb", long).flags], ["n"]);
  assert.throws(() => options(["--num"], "nb", long), /ambiguous/);
  assert.throws(() => options(["--unknown"], "nb", long), /unrecognized option/);
  assert.throws(() => options(["--=value"], "n", { number: "n" }), /unrecognized option/);
});

test("abbreviated long options preserve values, callbacks and operand boundaries", () => {
  const seen: unknown[] = [];
  const parsed = options(["--out", "--rev", "--out=second", "--", "--out"], "o:r", { output: "o", reverse: "r" },
    false, index => seen.push(index), (key, index, offset) => seen.push([key, index, offset]));
  assert.deepEqual(parsed.values.get("o"), ["--rev", "second"]);
  assert.deepEqual(parsed.operands, ["--out"]);
  assert.deepEqual(seen, [["o", 1, 0], ["o", 2, 6], 4]);
  assert.throws(() => options(["--out"], "o:", { output: "o" }), /requires an argument/);
  assert.throws(() => options(["--rev=yes"], "r", { reverse: "r" }), /does not take an argument/);
});

test("options retain repeated values and literal operands", () => { const parsed = options(["-aa", "-b", "one", "-b", "two", "--", "-x"], "ab:"); assert.deepEqual([...parsed.flags], ["a", "b"]); assert.deepEqual(parsed.values.get("b"), ["one", "two"]); assert.deepEqual(parsed.operands, ["-x"]); });
