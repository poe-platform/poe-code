import assert from "node:assert/strict";
import { it } from "node:test";
import { samiAst } from "./containers/sami.js";

for (const input of ["<P></P>", "<P>  ", "text without P"]) {
  it(`retains an empty SAMI interval for ${JSON.stringify(input)}`, () => {
    const doc = samiAst().parse(new TextEncoder().encode(
      `<SAMI>\n<BODY>\n<SYNC Start=1000>${input}\n<SYNC Start=3000><P>done\n</BODY>\n</SAMI>\n`));
    assert.deepEqual(doc.tracks[0]!.samples.map(sample =>
      [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
    [[1000, 2000, ""], [3000, 0xffffffff, "done"]]);
  });
}

it("suppresses a SAMI nonbreaking-space marker without suppressing later empty cues", () => {
  const doc = samiAst().parse(new TextEncoder().encode(
    "<SAMI><BODY><SYNC Start=1000><P>&nbsp;<SYNC Start=3000><P>done<SYNC Start=5000><P></P></BODY></SAMI>"));
  assert.deepEqual(doc.tracks[0]!.samples.map(sample =>
    [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
  [[3000, 2000, "done"], [5000, 0xffffffff, ""]]);
});
