import assert from "node:assert/strict";
import { it } from "node:test";
import { cafAst } from "./containers/caf.js";

const input = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d000000000000000200000001000000010000001064617461000000000000000c000000000064ff38012cfe70", "hex");

it("truncates fractional CAF sample rates for decoding and probing", () => {
  const ast = cafAst();
  const bytes = Buffer.from(input);
  bytes.writeDoubleBE(8000.75, 20);
  assert.deepEqual(ast.parse(bytes), ast.parse(input));
  assert.deepEqual(ast.probe(bytes), ast.probe(input));
});

it("rejects CAF rates that are invalid after truncation", () => {
  for (const rate of [NaN, Infinity, -Infinity, -8000.75, 0, 0.75]) {
    const bytes = Buffer.from(input);
    bytes.writeDoubleBE(rate, 20);
    assert.throws(() => cafAst().parse(bytes), /sample rate/);
    assert.throws(() => cafAst().probe(bytes), /sample rate/);
  }
});
