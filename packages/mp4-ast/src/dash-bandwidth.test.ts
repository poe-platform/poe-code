import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMp4, serializeDashDocument } from "./index.js";

// Stream rates verified with native ffprobe; AAC includes encoder lead-in.
for (const [fixture, video, audio] of [
  ["packet-positions-interleaved", 11224, 28588],
  ["aac-external", 22691, 70312]
] as const) {
  for (const segmentDuration of [1, 5]) {
    it(`uses source stream bandwidths for ${fixture} with ${segmentDuration}s segments`, () => {
      const source = parseMp4(readFileSync(new URL(`./fixtures/${fixture}.mp4`, import.meta.url)));
      const { manifest } = serializeDashDocument(source, { segmentDuration });
      const representations = new TextDecoder().decode(manifest).split("<Representation ").slice(1);
      assert.equal(representations.length, 2);
      for (const [index, bandwidth] of [video, audio].entries()) {
        assert.ok(representations[index]!.split(">")[0]!.includes(`bandwidth="${bandwidth}"`), representations[index]);
      }
    });
  }
}
