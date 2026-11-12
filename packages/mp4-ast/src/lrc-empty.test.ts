import assert from "node:assert/strict";
import { it } from "node:test";
import { lrcAst } from "./containers/lrc.js";
import { serializeSubtitleDocument } from "./containers/adapters.js";

it("preserves empty timestamped LRC cues in SRT output", () => {
  const doc = lrcAst().parse(new TextEncoder().encode("[00:01.20]First\n[00:02.00]\n[00:03.00]Two\n"));
  assert.equal(new TextDecoder().decode(serializeSubtitleDocument(doc, "srt")),
    "1\n00:00:01,200 --> 00:00:02,000\nFirst\n\n2\n00:00:02,000 --> 00:00:03,000\n\n\n3\n00:00:03,000 --> 1193:02:50,295\nTwo\n\n");
});
