import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNative, nativeExpected, nativeGrammar } from "./jq-grammar-native-v3.js";

for (const mutant of nativeGrammar.byteMutants) test(`native grammar byte assertion rejects documented mutant: ${mutant.id}`, () => {
  const vector = nativeGrammar.vectors.find(vector => vector.ids.includes(mutant.id));
  assert.ok(vector);
  assert.equal(vector.expected.stdoutHex, mutant.expectedHex);
  const actual = { status: vector.expected.status, stdoutBytes: Buffer.from(mutant.expectedHex, "hex"), stderrBytes: Buffer.from(vector.expected.stderrHex, "hex") };
  const input = Buffer.from(vector.inputHex, "hex");
  assertNative(actual, vector.argv, input, vector.files);
  assert.equal(Buffer.from(mutant.mutantHex, "hex").toString(), actual.stdoutBytes.toString());
  assert.throws(() => assertNative({ ...actual, stdoutBytes: Buffer.from(mutant.mutantHex, "hex") }, vector.argv, input, vector.files), assert.AssertionError);
});

test("native grammar lookup requires exact argv, input and files", () => {
  assert.throws(() => nativeExpected(["not-a-frozen-filter"], "null"), /missing frozen native input/u);
  assert.throws(() => nativeExpected(["-nc", "1/0"], ""), /missing frozen native input/u);
  assert.equal(nativeExpected(["-nc", "1/0"], "null").status, 5);
  assert.throws(() => nativeExpected(["-Rc", ".", "unicode-start", "-"], Buffer.from("98800a", "hex")), /missing frozen native input/u);
});
