import assert from "node:assert/strict";
import { it } from "node:test";
import { ircamAst } from "./containers/ircam.js";

// Native FFmpeg float32 fixtures: six stereo frames at 11025 Hz.
const pcm = Buffer.from("000000bf0000803e000000000000403f0000003e000080be0000803f000080bf000060bf0000c03e0000000000000000", "hex");

for (const littleEndian of [true, false]) {
  const header = littleEndian ? "64a3010000442c460200000004000000" : "0001a364462c44000000000200000004";
  const payload = littleEndian ? pcm : Buffer.from(pcm).swap32();
  for (const repetitions of [1, 200]) {
    it(`reads float32 IRCAM, littleEndian=${littleEndian}, frames=${repetitions * 6}`, () => {
      // A sliced buffer verifies that packet offsets are relative to the file.
      const bytes = Buffer.alloc(17 + 1024 + payload.length * repetitions).subarray(17);
      Buffer.from(header, "hex").copy(bytes);
      for (let i = 0; i < repetitions; i++) payload.copy(bytes, 1024 + payload.length * i);
      const ast = ircamAst();
      assert.equal(ast.detect(bytes), true);
      const doc = ast.parse(bytes);
      const audio = doc.tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 11025);
      assert.equal(audio.channels, 2);
      assert.deepEqual(Array.from(audio.channelData[0]!), Array.from({ length: repetitions }, () => [-0.5, 0, 0.125, 1, -0.875, 0]).flat());
      assert.deepEqual(Array.from(audio.channelData[1]!), Array.from({ length: repetitions }, () => [0.25, 0.75, -0.25, -1, 0.375, 0]).flat());
      assert.equal(ast.parse(bytes, { decodeAudio: false }).tracks[0]!.decodedAudio, undefined);
      const probe = ast.probe(bytes, { showPackets: true });
      assert.equal(probe.format.format_name, "ircam");
      assert.equal(probe.streams[0]!.codec_name, littleEndian ? "pcm_f32le" : "pcm_f32be");
      assert.equal(probe.streams[0]!.sample_rate, "11025");
      assert.equal(probe.streams[0]!.channels, 2);
      assert.equal(probe.streams[0]!.duration_ts, repetitions * 6);
      assert.deepEqual(probe.packets!.map(({ pts, pos, size, duration }) => ({ pts, pos, size, duration })), repetitions === 1
        ? [{ pts: 0, pos: "1024", size: "48", duration: 6 }]
        : [{ pts: 0, pos: "1024", size: "3528", duration: 441 },
          { pts: 441, pos: "4552", size: "3528", duration: 441 },
          { pts: 882, pos: "8080", size: "2544", duration: 318 }]);
      for (const limits of [{ maxInputBytes: bytes.length - 1 }, { maxMemoryBytes: 1 }, { maxDurationSeconds: 0.0001 }]) {
        assert.throws(() => ast.parse(bytes, { limits }), /limit/i);
      }
      if (repetitions > 1) assert.throws(() => ast.probe(bytes, { limits: { maxSamplesPerTrack: 2 } }), /limit/i);
      bytes.write("FAIL");
      assert.equal(ast.detect(bytes), false);
      assert.throws(() => ast.parse(bytes), /header/);
    });
  }
}
