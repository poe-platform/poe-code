import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseAvi } from "./containers/avi.js";

// Native FFmpeg: testsrc2=size=64x48:rate=2:duration=1 -vf setsar=1 -c:v libx264 -g 1,
// then -c copy -aspect 16:9 wide.avi. Native ffprobe reports SAR 4:3 and DAR 16:9.
const fixture = readFileSync(new URL("./fixtures/vprp-wide.avi", import.meta.url));
it("reads native AVI vprp display proportions as sample aspect ratio", () => {
  const description = parseAvi(fixture).tracks[0]!.codecDescriptions[0]!;
  assert.equal(description.sarWidth, 4);
  assert.equal(description.sarHeight, 3);
});

for (const field of [20, 24, 28]) {
  it(`ignores AVI vprp with zero aspect or frame dimension at ${field}`, () => {
    const bytes = Buffer.from(fixture);
    bytes.writeUInt32LE(0, bytes.indexOf("vprp") + 8 + field);
    const description = parseAvi(bytes).tracks[0]!.codecDescriptions[0]!;
    assert.equal(description.sarWidth, undefined);
    assert.equal(description.sarHeight, undefined);
  });
}
