import assert from "node:assert/strict";
import { it } from "node:test";
import { realtextAst } from "./index.js";

for (const [input, expected] of [
  ["A\n  B", "A B"],
  ["A   B", "A B"],
  ["A\tB", "A B"],
  [" \tA\r\n\f\v B \n", "A B"],
  ["A<br/>B", "A\nB"],
  ["A \n<br/> \tB", "A \nB"],
  ["A<br/> \tB", "A\n B"],
  ["A<br/><br/>B", "A\n\nB"],
  ['A <font color="red"> \n B</font> C', "A B C"],
  ["A\u00a0\u00a0B", "A\u00a0\u00a0B"]
] as const) {
  it(`normalizes ordinary RealText whitespace while retaining explicit breaks: ${JSON.stringify(input)}`, () => {
    const doc = realtextAst().parse(new TextEncoder().encode(
      `<window><time begin="1" end="2"><clear/>${input}</window>`
    ));
    assert.deepEqual(doc.tracks[0]!.samples.map(sample => [
      sample.pts, sample.duration, new TextDecoder().decode(sample.data)
    ]), [[1000, 1000, expected]]);
  });
}
