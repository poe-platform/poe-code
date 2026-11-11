import assert from "node:assert/strict";
import { it } from "node:test";
import { parseMkv, serializeMkv } from "./containers/mkv.js";
import { rawAudioAsts } from "./containers/raw-audio.js";

for (const format of ["s16le", "s24le", "f32le"]) {
  for (const filtered of [false, true]) {
    it(`encodes ${filtered ? "filtered" : "decoded"} audio as Matroska ${format}`, () => {
      const raw = rawAudioAsts().find(plugin => plugin.id === "f64le")!;
      const input = new Uint8Array(2000 * 8);
      const view = new DataView(input.buffer);
      for (let i = 0; i < 2000; i++) view.setFloat64(i * 8, (i - 1000) / 32768, true);
      const doc = raw.parse(input, { sampleRate: 8000, channels: 1 });
      const track = { ...doc.tracks[0]!, samples: filtered ? [] : doc.tracks[0]!.samples };
      const bytes = serializeMkv({ ...doc, tracks: [track] }, { audioCodec: `pcm_${format}` });
      const output = parseMkv(bytes).tracks[0]!;
      assert.equal(output.codecDescriptions[0]!.codecName, `pcm_${format}`);
      assert.deepEqual(output.decodedAudio, track.decodedAudio);
      assert.equal(output.samples[0]!.pts, 0);
      assert.equal(output.samples.at(-1)!.pts + output.samples.at(-1)!.duration, 250);
    });
  }
}
