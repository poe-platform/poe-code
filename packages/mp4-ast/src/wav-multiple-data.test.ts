import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseWav, probeWavSource, probeWavStream, wavAst } from "./index.js";

for (const fixture of ["wav-multiple-data.wav", "wav-multiple-data-gap.wav"]) {
  for (const seekable of [true, false]) {
    it(`preserves PCM chunk positions and timing in ${fixture}, seekable=${seekable}`, async () => {
      const bytes = readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url));
      const lastPosition = fixture.includes("gap") ? 72 : 60;
      const expected = seekable ? [{ pts: 0, duration: 3, pos: String(lastPosition), size: "6" }]
        : [{ pts: 0, duration: 4, pos: "44", size: "8" }, { pts: 4, duration: 3, pos: String(lastPosition), size: "6" }];
      const options = { seekable, showPackets: true, showFrames: true };
      const source = await probeWavSource({ size: bytes.length, async read(offset, length) {
        assert.ok(offset < 44 || offset >= 52 && offset < lastPosition, "must skip PCM payloads");
        return bytes.subarray(offset, offset + Math.min(length, 3));
      } }, options);
      const streamed = await probeWavStream((async function* () {
        for (const byte of bytes) yield Uint8Array.of(byte);
      })(), options);
      const buffered = wavAst().probe(bytes, options);
      for (const result of [source, streamed, buffered]) {
        assert.deepEqual(Array.from(result.packets ?? [], ({ pts, duration, pos, size }) => ({ pts, duration, pos, size })), expected);
        assert.deepEqual(Array.from(result.frames ?? [], ({ pts, nb_samples, pkt_pos, pkt_size }) =>
          ({ pts, duration: nb_samples, pos: pkt_pos, size: pkt_size })), expected);
      }
      const decoded = parseWav(bytes, { seekable }).tracks[0]!.decodedAudio!;
      assert.deepEqual(Array.from(decoded.channelData[0]!, sample => Math.round(sample * 32768)),
        seekable ? [-501, -502, -503] : [101, 102, 103, 104, -501, -502, -503]);
    });
  }
}

it("keeps single-chunk pipe decoding and probing identical to seekable input", async () => {
  const bytes = readFileSync(new URL("./fixtures/wav-multiple-data.wav", import.meta.url)).subarray(0, 52);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  assert.deepEqual(parseWav(bytes, { seekable: false }), parseWav(bytes));
  const options = { showPackets: true, showFrames: true };
  const piped = await probeWavStream((async function* () { yield bytes; })(), { ...options, seekable: false });
  const seekable = await probeWavStream((async function* () { yield bytes; })(), { ...options, seekable: true });
  assert.deepEqual({ ...piped, packets: Array.from(piped.packets!), frames: Array.from(piped.frames!) },
    { ...seekable, packets: Array.from(seekable.packets!), frames: Array.from(seekable.frames!) });
});
