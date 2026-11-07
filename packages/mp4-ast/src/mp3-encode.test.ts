import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { mp3Ast, parseWav } from "./containers/adapters.js";
import { decodeMp3Track } from "./mp3.js";

for (const [sampleRate, channels, count] of [[44100, 1, 44100], [48000, 2, 4097], [8000, 1, 9]] as const) {
  it(`encodes MP3 with ${count} samples at ${sampleRate} Hz and ${channels} channels`, () => {
    const input = Array.from({ length: channels }, (_, channel) => Float64Array.from({ length: count },
      (_, i) => 0.5 * Math.sin(2 * Math.PI * (440 + channel * 220) * i / sampleRate)));
    const plugin = mp3Ast();
    const bytes = plugin.serialize(parseWav(encodeWav({ sampleRate, channels: input })));
    const track = plugin.parse(bytes).tracks[0]!;
    const audio = decodeMp3Track(track);
    assert.equal(audio.channels, channels);
    assert.equal(audio.sampleRate, sampleRate);
    for (let channel = 0; channel < channels; channel++) {
      const actual = audio.channelData[channel]!;
      assert.equal(actual.length, count);
      assert.ok(actual.some(value => Math.abs(value) > 0.01));
      if (count > 1000) {
        const error = Array.from(actual).reduce((sum, value, i) => sum + (value - input[channel]![i]!) ** 2, 0) / count;
        assert.ok(error < 0.005, `mean square error ${error}`);
      }
    }
  });
}
