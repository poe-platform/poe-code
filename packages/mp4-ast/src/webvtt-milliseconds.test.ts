import assert from "node:assert/strict";
import { it } from "node:test";
import { parseSubtitleDocument, serializeSubtitleDocument } from "./containers/adapters.js";

for (const prefix of ["", "01:"]) {
  for (const [start, end, expectedStart, expectedEnd] of [
    ["01.2", "02.34", "01.002", "02.034"],
    ["01.1234", "03.0020", "02.234", "03.020"],
    ["01.250", "02.500", "01.250", "02.500"]
  ]) {
    it(`reads WebVTT ${prefix}00:${start} milliseconds like FFmpeg`, () => {
      const input = `WEBVTT\n\n${prefix}00:${start} --> ${prefix}00:${end}\nHello\n`;
      const doc = parseSubtitleDocument(new TextEncoder().encode(input), "webvtt");
      assert.equal(new TextDecoder().decode(serializeSubtitleDocument(doc, "webvtt")),
        `WEBVTT\n\n${prefix}00:${expectedStart} --> ${prefix}00:${expectedEnd}\nHello\n`);
    });
  }
}
