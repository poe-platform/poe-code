import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeDashDocument } from "./index.js";

const dash = "urn:mpeg:dash:profile:isoff-live:2011";
const dvb = "urn:dvb:dash:profile:dvb-dash:2014";
for (const [mpdProfile, expected] of [[undefined, dash], ["dash", dash], ["dvb_dash", dvb], ["dash+dvb_dash", `${dash},${dvb}`], ["dvb_dash+dash", `${dash},${dvb}`]] as const) {
  it(`serializes DASH profile ${mpdProfile ?? "default"}`, () => {
    const doc = parseMp4(createSyntheticMp4({ width: 32, height: 24, frameCount: 4, includeAudio: false }));
    const { manifest } = serializeDashDocument(doc, { mpdProfile });
    assert.equal(new TextDecoder().decode(manifest).split('profiles="')[1]?.split('"')[0], expected);
  });
}
it("rejects unknown profile names before serialization", () => {
  const doc = parseMp4(createSyntheticMp4({ width: 32, height: 24, frameCount: 4, includeAudio: false }));
  assert.throws(() => serializeDashDocument(doc, { mpdProfile: 'dash+unknown' }), /mpd_profile/);
});
