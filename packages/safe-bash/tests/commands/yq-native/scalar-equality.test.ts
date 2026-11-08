import assert from "node:assert/strict";
import { test } from "node:test";
import { native, nativeOptions, run } from "./helpers.js";

const cases = [
  ["true", "true", true],
  ["True", "true", false],
  ["TRUE", "true", false],
  ["False", "false", false],
  ["1.0", "1", false],
  ["0x10", "16", false],
  ["1", "1.0", false],
  ["1.0", "1.0", true],
  ["1e2", "100", false],
  ["1e2", "1e2", true],
  ["-1.0", "-1.0", true],
  ["-1", "-1.0", false],
  ["9007199254740993", "9007199254740992", false],
  ["9007199254740993", "9007199254740992.0", false],
  ["1", '"1"', true],
  ["true", '"true"', true],
  ['"1"', "1", true],
  ['"true"', "true", true],
  ["null", "null", true],
  ["null", '"null"', false],
  ['"null"', "null", true],
  ['"hello"', '"h*o"', true],
  ['"hello"', '"x*"', false],
] as const;

for (const [input, operand, equal] of cases) {
  for (const operator of ["==", "!="]) {
    test(`Mike yq scalar equality: ${input} ${operator} ${operand}`, async () => {
      assert.deepEqual(await run([`.a ${operator} ${operand}`], `a: ${input}\n`), {
        status: 0, stdout: `${operator === "==" ? equal : !equal}\n`, stderr: "",
      });
    });
  }
}

test("pinned native yq confirms scalar spelling and asymmetric null comparisons", nativeOptions, async () => {
  for (const [input, operand, equal] of cases) {
    for (const operator of ["==", "!="]) {
      assert.deepEqual(await native([`.a ${operator} ${operand}`], `a: ${input}\n`), {
        status: 0, stdout: `${operator === "==" ? equal : !equal}\n`, stderr: "",
      }, `${input} ${operator} ${operand}`);
    }
  }
});
