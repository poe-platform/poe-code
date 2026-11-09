import assert from "node:assert/strict";
import { it } from "node:test";
import { packIsoLanguage, unpackIsoLanguage } from "./binary.js";

// mdhd values observed from native FFmpeg stream metadata assignments.
for (const [language, packed] of [
  ["French", 0x7fff], ["Fra", 0x7fff], ["ENG", 0x7fff], ["fr", 0x7fff],
  ["french", 0x1a45], ["deu", 0x10b5], ["eng", 0x15c7], ["", 0x55c4]
] as const) {
  it(`encodes MP4 language ${JSON.stringify(language)} like FFmpeg`, () => {
    assert.equal(packIsoLanguage(language), packed);
  });
}

for (const [code, language] of [
  [0, "eng"], [1, "fra"], [2, "ger"], [5, "sve"], [18, "hr "],
  [33, "chi"], [34, "und"], [58, "und"], [94, "epo"], [95, "und"],
  [127, "und"], [128, "wel"], [138, "jav"], [139, "und"], [0x3ff, "und"],
  [0x15c7, "eng"], [0x1a41, "fra"], [0x10b5, "deu"], [0x55c4, "und"], [0x7fff, "und"]
] as const) {
  it(`decodes mdhd language code ${code} as ${JSON.stringify(language)}`, () => {
    assert.equal(unpackIsoLanguage(code), language);
  });
}
