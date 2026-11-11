import assert from "node:assert/strict";
import { it } from "node:test";
import { samiAst } from "./containers/sami.js";

for (const paragraph of ["<P>&nbsp;word", "<P>red</P><P>&nbsp;</P><P>green", "<P>\n\t&nbsp;word"]) {
  it(`suppresses the entire SAMI cue for a leading marker: ${paragraph}`, () => {
    const doc = samiAst().parse(new TextEncoder().encode(`<SAMI><BODY><SYNC Start=1000>${paragraph}<SYNC Start=3000><P>done</BODY></SAMI>`));
    assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, new TextDecoder().decode(sample.data)]), [[3000, "done"]]);
    assert.deepEqual(doc.tracks[0]!.decodeErrors, ["Error decoding subtitles: Operation not permitted"]);
  });
}

for (const paragraph of ["<P>plain", "<P>word&nbsp;", "<P>&#160;word", "<P>\u00a0word", "<P><b>&nbsp;</b>word", "<P>&NBSP;word"]) {
  it(`does not treat other SAMI text as a leading marker: ${paragraph}`, () => {
    const doc = samiAst().parse(new TextEncoder().encode(`<SAMI><BODY><SYNC Start=1000>${paragraph}</BODY></SAMI>`));
    assert.equal(doc.tracks[0]!.samples.length, 1);
    assert.equal(doc.tracks[0]!.decodeErrors?.length ?? 0, 0);
  });
}
