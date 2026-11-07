import assert from "node:assert/strict";
import { it } from "node:test";
import { allMediaAsts, createMediaAstRegistry, parseSubtitleDocument } from "./containers/adapters.js";

it("detects SubViewer by timecodes, not the shared MicroDVD extension", () => {
  const registry = createMediaAstRegistry(allMediaAsts());
  const encode = (text: string) => new TextEncoder().encode(text);
  for (const filename of [undefined, "captions.sub", "captions.bin"]) {
    const input = encode("[SUBTITLE]\r\n00:00:01.24,00:00:02.80\r\nCafé[br]€2\r\n");
    const plugin = registry.detect(input, filename);
    assert.equal(plugin?.id, "subviewer");
    const doc = plugin!.parse(input);
    assert.equal(doc.containerFormat, "subviewer");
    assert.equal(doc.durationSeconds, 2.8);
    assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration,
      new TextDecoder().decode(sample.data)]), [[1240, 1560, "Café\n€2"]]);
    assert.notEqual(registry.detect(encode("{25}{70}First|second\n"), filename)?.id, "subviewer");
    assert.notEqual(registry.detect(encode("00:00:xx.24,00:00:02.80\nInvalid\n"), filename)?.id, "subviewer");
  }
  assert.equal(parseSubtitleDocument(encode("[INFORMATION]\n[TITLE]Only metadata\n"), "subviewer").tracks[0]!.samples.length, 0);
});
