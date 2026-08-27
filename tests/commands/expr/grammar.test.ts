import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./helpers.js";

const cases: readonly [readonly string[], string, number][] = [
  [["2", "+", "3", "*", "4"], "14", 0],
  [["(", "2", "+", "3", ")", "*", "4"], "20", 0],
  [["20", "-", "5", "-", "3"], "12", 0],
  [["-7", "/", "3"], "-2", 0], [["7", "/", "-3"], "-2", 0],
  [["-7", "%", "3"], "-1", 0], [["7", "%", "-3"], "1", 0],
  [["9007199254740993", "+", "2"], "9007199254740995", 0],
  [["999999999999999999999999", "*", "999999999999999999999999"], "999999999999999999999998000000000000000000000001", 0],
  [["0003", "+", "-02"], "1", 0], [["0003"], "0003", 0],
  [["1", "<", "2", "=", "1"], "1", 0], [["02", "==", "2"], "1", 0],
  [["-0", "=", "000"], "1", 0], [["10", "<", "2"], "0", 1],
  [["10", "<", "2x"], "1", 0], [["a", "!=", "b"], "1", 0],
  [["x", "|", "y"], "x", 0], [["", "|", "02"], "02", 0],
  [["-00", "|", "000"], "0", 1], [["02", "&", "x"], "02", 0],
  [["x", "&", "-00"], "0", 1], [["-000"], "-000", 1],
  [["+0"], "+0", 0], [["-"], "-", 0], [[""], "", 1],
  [["1", "|", "2", "&", "0"], "1", 0],
  [["length", "hello"], "5", 0], [["length", "length", "abcd"], "1", 0],
  [["length", "abc", "+", "2"], "5", 0],
  [["substr", "abcdef", "2", "3"], "bcd", 0],
  [["substr", "abcdef", "-1", "3"], "", 1],
  [["substr", "abcdef", "2", "-3"], "", 1],
  [["substr", "abcdef", "0", "3"], "", 1],
  [["substr", "abcdef", "no", "3"], "", 1],
  [["substr", "abcdef", "2", "999999999999999999999999"], "bcdef", 0],
  [["substr", "abcdef", "999999999999999999999999", "2"], "", 1],
  [["index", "abcdef", "fd"], "4", 0], [["index", "abc", "z"], "0", 1],
  [["index", "abc", ""], "0", 1], [["length", "(", "2", "+", "3", ")"], "1", 0],
  [["+", "length"], "length", 0], [["+", ")"], ")", 0], [["+", "+"], "+", 0],
  [["length", "+", "match"], "5", 0], [["*"], "*", 0], [["|"], "|", 0],
  [["--unknown"], "--unknown", 0], [["-x"], "-x", 0], [["--", "--help"], "--help", 0],
  [["1", "|", "1", "/", "0"], "1", 0], [["0", "&", "x", "+", "y"], "0", 1],
  [["1", "|", "match", "x", "["], "1", 0], [["0", "&", "x", ":", "["], "0", 1],
];

for (const [args, stdout, exitCode] of cases) test(`expr grammar ${JSON.stringify(args)}`, async () => {
  const actual = await run(args);
  assert.equal(actual.stdout, `${stdout}\n`);
  assert.equal(actual.exitCode, exitCode, actual.stderr);
  assert.equal(actual.stderr, "");
});

for (const args of [[], ["--"], ["+"], ["length"], ["("], [")"], ["(", "1"], ["1", "2"], ["1", "+"],
  ["1", "|", "(", "1", "+"], ["1", "|", "match", "x"], ["1", "|", "+"], ["1", "&", "2", ")"],
  ["1", "/", "0"], ["1", "%", "0"], ["+5", "+", "1"], [" 5", "*", "1"], ["--help", "x"]]) {
  test(`expr invalid ${JSON.stringify(args)}`, async () => {
    const actual = await run(args);
    assert.equal(actual.exitCode, 2); assert.equal(actual.stdout, "");
    if (args.length === 0 || (args.length === 1 && args[0] === "--")) {
      assert.equal(actual.stderr, "expr: missing operand\nTry 'expr --help' for more information.\n");
    } else {
      assert.match(actual.stderr, /^expr: (syntax error|division by zero|non-integer argument)/u);
    }
  });
}

test("help and version identify virtual-bash, not a fabricated GNU build", async () => {
  assert.match((await run(["--help"])).stdout, /^Usage: expr/u);
  assert.equal((await run(["--version"])).stdout, "expr (virtual-bash)\n");
});
