import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { aiffAst, parseAiff } from "./containers/aiff.js";
import { rawAudioAsts } from "./containers/raw-audio.js";

// Native FFmpeg adpcm_ima_qt fixtures and independently decoded PCM16 hashes.
const fixtures = [
  ["mono", "464f524d00000062414946434656455200000004a2805140434f4d4d000000180001000000010004400bfa00000000000000696d6134000053534e440000002a00000000000000000000f7f7828080808000080808088880808080800000000000000000000000000000", "1f1fd5a44d0d302f808556dfc0f46fe74af2ba8620068bbbca59b85f0670b044"],
  ["stereo", "464f524d0000010c414946434656455200000004a2805140434f4d4d000000180002000000030004400bfa00000000000000696d6134000053534e44000000d400000000000000000000ffffffcf3434244333f3ff08001000010111f29f0010000001111111ff0900000000ffffffaf3624243343ff0e00000001011111f19f00001000111021f19f000000ef4d0110011121ff0900001010101121f1af00010001112011f1af00010001111111f24c0101111112ff0a10001010112021ff0a00011010102111f2bf010001101111213c4312ff0a00000111111112ff00080808080808080808080808880088800008880042c2f1af0000101011112121ff088008800808808008088080080880800808808008", "1ce2f8eae8d049fcb5fe2f4382d9c875119983a37b48a75d4c391ff0b4fa13e3"],
] as const;
for (const [name, hex, hash] of fixtures) {
  it(`decodes native ${name} QuickTime IMA packets exactly`, () => {
    const doc = parseAiff(Buffer.from(hex, "hex"));
    const raw = rawAudioAsts().find(p => p.id === "s16le")!.serialize(doc);
    assert.equal(createHash("sha256").update(raw).digest("hex"), hash);
    assert.equal(doc.duration, name === "mono" ? 64 : 192);
  });
}
it("probes compressed packet timing without allocating decoded audio", async () => {
  const bytes = Buffer.from(fixtures[1][1], "hex");
  assert.equal(parseAiff(bytes, { decodeAudio: false }).tracks[0]!.decodedAudio, undefined);
  const probe = await aiffAst().probe!(bytes, { showPackets: true });
  assert.equal(probe.streams[0]!.codec_name, "adpcm_ima_qt");
  assert.equal(probe.streams[0]!.duration, "0.024000");
  assert.deepEqual(Array.from(probe.packets!).map(p => [p.pts, p.duration, p.size]), [[0, 64, "68"], [64, 64, "68"], [128, 64, "68"]]);
});
it("rejects invalid step indexes, truncated packets and decoded memory over budget", () => {
  const bytes = Buffer.from(fixtures[0][1], "hex");
  const invalid = Buffer.from(bytes);
  invalid[73] = 89;
  assert.throws(() => parseAiff(invalid), /IMA.*index/);
  const truncated = bytes.subarray(0, bytes.length - 2);
  truncated.writeUInt32BE(truncated.length - 8, 4);
  truncated.writeUInt32BE(40, 60);
  assert.throws(() => parseAiff(truncated), /IMA.*packet/);
  assert.throws(() => parseAiff(Buffer.from(fixtures[0][1], "hex"), { limits: { maxMemoryBytes: 1 } }), /memory/i);
});
