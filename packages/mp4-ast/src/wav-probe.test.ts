import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWav, buildProbeResultFromDoc } from "./index.js";

for (const [tag, bits, codec, format] of [[1, 8, "pcm_u8", "u8"], [1, 16, "pcm_s16le", "s16"], [1, 24, "pcm_s24le", "s32"], [1, 32, "pcm_s32le", "s32"], [3, 32, "pcm_f32le", "flt"]] as const) {
  it(`probes ${codec} WAV stream and frame metadata`, () => {
    const bytes = new Uint8Array(44 + bits / 8);
    const view = new DataView(bytes.buffer);
    for (const [offset, text] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const) bytes.set(new TextEncoder().encode(text), offset);
    view.setUint32(4, bytes.length - 8, true);
    view.setUint32(16, 16, true);
    view.setUint16(20, tag, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 8000 * bits / 8, true);
    view.setUint16(32, bits / 8, true);
    view.setUint16(34, bits, true);
    view.setUint32(40, bits / 8, true);
    const result = buildProbeResultFromDoc(parseWav(bytes), bytes.length, "input.wav", { showFrames: true });
    const stream = result.streams[0]!;
    assert.equal(stream.codec_name, codec);
    assert.equal(stream.sample_fmt, format);
    assert.equal(stream.codec_tag_string, `[${tag}][0][0][0]`);
    assert.equal(stream.codec_tag, `0x000${tag}`);
    assert.equal(stream.has_b_frames, undefined);
    assert.equal(result.frames?.[0]?.sample_fmt, format);
  });
}
