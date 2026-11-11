import assert from "node:assert/strict";
import { it } from "node:test";
import { pjsAst } from "./index.js";
import { serializeSubtitleDocument } from "./containers/adapters.js";

for (const [dialogue, expected] of [
  ["Alpha  ", "Alpha  "],
  ["  Alpha", "Alpha"],
  ["  Alpha  ", "Alpha  "],
  ["Alpha  Beta  ", "Alpha  Beta  "]
]) {
  it(`preserves PJS trailing dialogue spaces in SRT for ${JSON.stringify(dialogue)}`, () => {
    const doc = pjsAst().parse(new TextEncoder().encode(`10,20,"${dialogue}"\n`));
    assert.equal(new TextDecoder().decode(doc.tracks[0]!.samples[0]!.data), dialogue);
    assert.equal(new TextDecoder().decode(serializeSubtitleDocument(doc, "srt")),
      `1\n00:00:01,000 --> 00:00:02,000\n${expected}\n\n`);
  });
}
