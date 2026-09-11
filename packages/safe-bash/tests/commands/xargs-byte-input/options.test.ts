import assert from "node:assert/strict";
import test from "node:test";
import { options } from "../../../src/commands/internal.js";

for (const fixture of [
  { name: "separate", args: ["-I", "�", "capture", "-Iignored"], origins: [["I", 1, 0]], operands: [2, 3] },
  { name: "attached", args: ["-I�", "capture"], origins: [["I", 0, 2]], operands: [1] },
  { name: "cluster", args: ["-rI�", "capture"], origins: [["I", 0, 3]], operands: [1] },
  { name: "long", args: ["--replace", "�", "capture"], origins: [["I", 1, 0]], operands: [2] },
  { name: "equals", args: ["--replace=�", "capture"], origins: [["I", 0, 10]], operands: [1] },
  { name: "empty equals", args: ["--replace=", "capture"], origins: [["I", 0, 10]], operands: [1] },
  { name: "consumed option-looking value", args: ["-E", "-Ibad", "-I", "good", "capture"], origins: [["E", 1, 0], ["I", 3, 0]], operands: [4] },
  { name: "last occurrence", args: ["-Iold", "--replace=�", "capture"], origins: [["I", 0, 2], ["I", 1, 10]], operands: [2] },
  { name: "end marker", args: ["-I�", "--", "-Ioperand"], origins: [["I", 0, 2]], operands: [2] },
]) test(`shared options value consumption origins: ${fixture.name}`, () => {
  const origins: (string | number)[][] = [];
  const operands: number[] = [];
  const parsed = options(fixture.args, "rI:E:", { replace: "I", eof: "E" }, true,
    index => { operands.push(index); },
    (key: string, index: number, offset: number) => { origins.push([key, index, offset]); });
  assert.deepEqual(origins, fixture.origins);
  assert.deepEqual(operands, fixture.operands);
  assert.deepEqual(parsed, options(fixture.args, "rI:E:", { replace: "I", eof: "E" }, true));
});

test("missing values produce no value-origin event", () => {
  for (const args of [["-I"], ["--replace"]]) {
    let calls = 0;
    assert.throws(() => options(args, "I:", { replace: "I" }, true, undefined, () => { calls++; }), /requires an argument/);
    assert.equal(calls, 0);
  }
});
