import assert from "node:assert/strict";
import { it } from "node:test";
import { parseAiff, aiffAst } from "./containers/aiff.js";
// Generated independently with native FFmpeg from PCM16 [100, -200, 300, -400].
const fixtures = [[32, "464f524d00000050414946434656455200000004a2805140434f4d4d000000180001000000040020400bfa00000000000000666c3332000053534e440000001800000000000000003b480000bbc800003c160000bc480000"], [64, "464f524d00000060414946434656455200000004a2805140434f4d4d000000180001000000040040400bfa00000000000000666c3634000053534e440000002800000000000000003f69000000000000bf790000000000003f82c00000000000bf89000000000000"]] as const;

for (const [bits, hex] of fixtures) {
  it(`reads and probes native fl${bits} AIFF-C`, () => {
    const bytes = Buffer.from(hex, "hex");
    const doc = parseAiff(bytes);
    assert.equal(doc.tracks[0]!.codecDescriptions[0]!.codecName, `pcm_f${bits}be`);
    assert.deepEqual(Array.from(doc.tracks[0]!.decodedAudio!.channelData[0]!, value => value * 32768), [100, -200, 300, -400]);
    assert.equal(doc.durationSeconds, 4 / 8000);
    assert.equal(aiffAst().probe(bytes).streams[0]!.codec_name, `pcm_f${bits}be`);
  });
}
