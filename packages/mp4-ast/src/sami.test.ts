import assert from "node:assert/strict";
import { it } from "node:test";
import { samiAst } from "./containers/sami.js";
import { allMediaAsts, createMediaAstRegistry } from "./containers/adapters.js";

it("detects SAMI and reads unclosed paragraphs, entities, and line breaks", () => {
  const bytes = new TextEncoder().encode('<sami><head><title>Not a caption</title></head><body>\n<sync start="1240"><p class="ENCC">Café &amp; tea<br /> continuation\n<sync start=3400><p>Last caption</body></sami>');
  const plugin = createMediaAstRegistry(allMediaAsts()).detect(bytes, "input.bin");
  assert.equal(plugin?.id, "sami");
  const doc = plugin!.parse(bytes);
  assert.deepEqual(doc.tracks[0]!.samples.map(s => [s.pts, s.duration, new TextDecoder().decode(s.data)]),
    [[1240, 2160, "Café & tea\ncontinuation"], [3400, 0xffffffff, "Last caption"]]);
  assert.equal(samiAst().probe(bytes).streams[0]?.codec_type, "subtitle");
  assert.equal(samiAst().canMux, false);
  assert.throws(() => samiAst().serialize(doc), /SAMI output is not supported/);
});

it("uses empty SYNC captions as end markers without displaying them", () => {
  const doc = samiAst().parse(new TextEncoder().encode('<SAMI><BODY><SYNC Start=1000><P>First<SYNC Start=2500><P>&nbsp;<SYNC Start=4000><P>Second<SYNC Start=5000><P>&nbsp;</BODY></SAMI>'));
  assert.deepEqual(doc.tracks[0]!.samples.map(s => [s.pts, s.duration, new TextDecoder().decode(s.data)]),
    [[1000, 1500, "First"], [4000, 1000, "Second"]]);
});
