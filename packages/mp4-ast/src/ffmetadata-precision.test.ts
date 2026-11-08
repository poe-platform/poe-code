import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata } from "./index.js";

it("exports edited chapter boundaries using the source time base", () => {
  const doc = parseFfmetadata(new TextEncoder().encode(
    ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/48000\nSTART=1\nEND=49\ntitle=beat\n"
  ));
  const edited = { ...doc, chapters: doc.chapters!.map(chapter => ({
    ...chapter, startTimeSeconds: 2 / 48000, endTimeSeconds: 50 / 48000
  })) };
  assert.equal(new TextDecoder().decode(serializeFfmetadata(edited)),
    ";FFMETADATA1\n\n[CHAPTER]\nTIMEBASE=1/48000\nSTART=2\nEND=50\ntitle=beat\n");
});
