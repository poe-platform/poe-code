import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./helpers.js";

for (const [input, operand, equal] of [
  ["True", "true", true],
  ["TRUE", "true", true],
  ["False", "false", true],
  ["1.0", "1", true],
  ["0x10", "16", true],
  ["1", "1.0", true],
  ["9007199254740993", "9007199254740992", false],
  ["9007199254740993", "9007199254740992.0", false],
  ["1", '"1"', false],
  ["true", '"true"', false],
  ['"1"', "1", false],
  ['"true"', "true", false],
  ["null", "null", true],
  ["null", '"null"', false],
  ['"null"', "null", false],
  ['"hello"', '"h*o"', true],
  ['"hello"', '"x*"', false],
] as const) {
  for (const operator of ["==", "!="]) {
    test(`Mike yq typed scalar equality: ${input} ${operator} ${operand}`, async () => {
      assert.deepEqual(await run([`.a ${operator} ${operand}`], `a: ${input}\n`), {
        status: 0, stdout: `${operator === "==" ? equal : !equal}\n`, stderr: "",
      });
    });
  }
}
