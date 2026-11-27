import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./test-helpers.js";

for (const [filter, expected] of [
  ['[pow(2;10), (8|log2), (1|exp), (100|log), (2|exp10), (0|sin), (0|cos), (8|cbrt), (1|isnormal)]', '[1024,3,2.718281828459045,4.605170185988092,100,0,1,2,true]'],
  ['[pow((2,3);(2,3))]', '[4,9,8,27]'],
  ['2 | [pow(.;3), pow(error("unused");empty)]', '[8]'],
  ['[100|log10, (3|exp2), (0|expm1), (0|log1p), (0|tan), (0|asin), (1|acos), (0|atan), (0|sinh), (0|cosh), (0|tanh), (0|asinh), (1|acosh), (0|atanh), (-1.9|trunc)]', '[2,8,0,0,0,0,0,0,0,1,0,0,0,0,-1]'],
  ['[atan2(0;1), hypot(3;4), fmin(2;3), fmax(2;3), fmod(5.5;2)]', '[0,5,2,3,1.5]'],
  ['[0,1,-1,1e-310,2.2250738585072014e-308,infinite,nan,"x",null] | map(isnormal)', '[false,true,true,false,true,false,false,false,false]'],
  ['[(-1|log), pow(-1;0.5)]', '[null,null]'],
] as const) {
  test(`jq math: ${filter}`, async () => {
    const result = await run(['-nc', filter]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, `${expected}\n`);
  });
}

for (const filter of ['"x"|log', 'null|sin', 'pow("2";3)', 'pow(2;null)', 'hypot([];1)']) {
  test(`jq math rejects nonnumbers: ${filter}`, async () => {
    const result = await run(['-nc', filter]);
    assert.equal(result.exitCode, 5, result.stderr);
  });
}
