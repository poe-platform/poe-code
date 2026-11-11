import assert from "node:assert/strict";
import { it } from "node:test";
import { lrcAst } from "./containers/lrc.js";

it("imports LRC headers as format metadata without changing lyric text", () => {
  const bytes = new TextEncoder().encode(
    "[ti:Verse]\r\n[ar:Band]\r\n[al:Book]\r\n[au:Writer]\r\n[length:02:00]\r\n[00:05.00]end [ti:lyric]\r\n");
  const doc = lrcAst().parse(bytes);
  assert.deepEqual(doc.metadata, {
    title: "Verse", artist: "Band", album: "Book", custom: { author: "Writer", length: "02:00" }
  });
  assert.equal(new TextDecoder().decode(doc.tracks[0]!.samples[0]!.data), "end [ti:lyric]");
  assert.deepEqual(lrcAst().probe!(bytes, {}).format.tags, {
    title: "Verse", artist: "Band", album: "Book", author: "Writer", length: "02:00"
  });
});

for (const header of ["", "[offset:500]\n"]) {
  it(`does not export timing directives as metadata: ${header}`, () => {
    const doc = lrcAst().parse(new TextEncoder().encode(`${header}[00:05.00]end\n`));
    assert.deepEqual(doc.metadata, {});
  });
}

it("preserves empty and colon-containing values and replaces repeated headers", () => {
  const bytes = new TextEncoder().encode(
    "[ti:First]\n[ti:Last]\n[ar:]\n[au: Writer: Name ]\n[length:02:00]\n[00:05.00]end\n");
  assert.deepEqual(lrcAst().parse(bytes).metadata, {
    title: "Last", artist: "", custom: { author: " Writer: Name ", length: "02:00" }
  });
});
