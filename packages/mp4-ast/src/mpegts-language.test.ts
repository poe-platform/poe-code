import assert from "node:assert/strict";
import { it } from "node:test";
import { createSyntheticMp4, parseMp4, serializeMpegTs } from "./index.js";

for (const language of ["eng", "fra", "deu", "und", "", "en"]) {
  it(`writes the audio language descriptor for '${language}' without changing PES packets`, () => {
    const source = parseMp4(createSyntheticMp4({ frameCount: 2, includeAudio: true }));
    const baseline = serializeMpegTs(source);
    const bytes = serializeMpegTs({ ...source, tracks: source.tracks.map(track => ({ ...track, language })) });
    for (let offset = 0; offset < bytes.length; offset += 188) {
      const packet = bytes.subarray(offset, offset + 188);
      const pid = ((packet[1]! & 31) << 8) | packet[2]!;
      if (pid !== 0x1000) {
        assert.deepEqual(packet, baseline.subarray(offset, offset + 188));
        continue;
      }
      const section = packet.subarray(5, 5 + 3 + (((packet[6]! & 15) << 8) | packet[7]!));
      let crc = 0xffffffff;
      for (const byte of section) {
        crc ^= byte << 24;
        for (let bit = 0; bit < 8; bit++) crc = (crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0);
      }
      assert.equal(crc, 0);
      let entry = 12 + (((section[10]! & 15) << 8) | section[11]!);
      const entries = [];
      while (entry < section.length - 4) {
        const length = ((section[entry + 3]! & 15) << 8) | section[entry + 4]!;
        entries.push([section[entry], [...section.subarray(entry + 5, entry + 5 + length)]]);
        entry += 5 + length;
      }
      assert.deepEqual(entries, [[0x1b, []], [0x0f, language.length === 3 ? [10, 4, ...Buffer.from(language), 0] : []]]);
    }
  });
}
