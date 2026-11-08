import assert from "node:assert/strict";
import { it } from "node:test";
import { packIsoLanguage } from "./binary.js";

// mdhd values observed from native FFmpeg stream metadata assignments.
for (const [language, packed] of [
  ["French", 0x7fff], ["Fra", 0x7fff], ["ENG", 0x7fff], ["fr", 0x7fff],
  ["french", 0x1a45], ["deu", 0x10b5], ["eng", 0x15c7], ["", 0x55c4]
] as const) {
  it(`encodes MP4 language ${JSON.stringify(language)} like FFmpeg`, () => {
    assert.equal(packIsoLanguage(language), packed);
  });
}
