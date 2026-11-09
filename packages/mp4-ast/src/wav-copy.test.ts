import assert from "node:assert/strict";
import { it } from "node:test";
import { parseWav, serializeWav } from "./containers/adapters.js";

function chunk(id: string, data: Buffer): Buffer {
  const result = Buffer.alloc(8 + data.length + data.length % 2);
  result.write(id);
  result.writeUInt32LE(data.length, 4);
  data.copy(result, 8);
  return result;
}

for (const [tag, bits] of [[1, 16], [3, 32], [6, 8], [7, 8], [17, 4], [85, 0], [255, 0], [0xfffe, 24]]) {
  it(`WAV copy preserves format, extensions and payload while updating fact (tag ${tag})`, () => {
    const fmt = Buffer.alloc(tag === 0xfffe ? 40 : 20);
    fmt.writeUInt16LE(tag!, 0);
    fmt.writeUInt16LE(2, 2);
    fmt.writeUInt32LE(8000, 4);
    fmt.writeUInt32LE(1234, 8);
    fmt.writeUInt16LE(256, 12);
    fmt.writeUInt16LE(bits!, 14);
    fmt.writeUInt16LE(fmt.length - 18, 16);
    fmt.writeUInt16LE(505, 18);
    if (tag === 0xfffe) {
      fmt.writeUInt32LE(3, 20);
      fmt.writeUInt32LE(1, 24);
      fmt.set(Buffer.from("00001000800000aa00389b71", "hex"), 28);
    }
    const fact = Buffer.from([9, 0, 0, 0]);
    const payload = tag === 85 ? Buffer.alloc(216) : Buffer.from(Array.from({ length: tag === 1 ? 12 : tag === 3 || tag === 17 ? 16 : tag === 0xfffe ? 18 : 9 }, (_, i) => i));
    if (tag === 85) payload.writeUInt32BE(0xfffb38c4, 0); // 48 kbit/s MPEG frame; preserve the existing WAV rate.
    const body = Buffer.concat([Buffer.from("WAVE"), chunk("fmt ", fmt), chunk("fact", fact), chunk("data", payload)]);
    const input = chunk("RIFF", body);
    const output = serializeWav(parseWav(input, { decodeAudio: false }), { audioCodec: "copy" });
    const expected = Buffer.from(input);
    const counts: Record<number, number> = { 1: 3, 3: 2, 6: 4, 7: 4, 17: 9, 85: 288, 255: 9, 0xfffe: 3 };
    expected.writeUInt32LE(counts[tag!]!, 12 + 8 + fmt.length + 8);
    assert.deepEqual(Buffer.from(output), expected);
    assert.equal(input.readUInt32LE(12 + 8 + fmt.length + 8), 9);
  });
}

for (const empty of [false, true]) {
  it(`counts selected packets without changing the source fact chunk (${empty ? "empty" : "rescaled"})`, () => {
    const fmt = Buffer.alloc(18);
    fmt.writeUInt16LE(6); fmt.writeUInt16LE(1, 2);
    fmt.writeUInt32LE(8000, 4); fmt.writeUInt32LE(8000, 8);
    fmt.writeUInt16LE(1, 12); fmt.writeUInt16LE(8, 14);
    const input = chunk("RIFF", Buffer.concat([Buffer.from("WAVE"), chunk("fmt ", fmt),
      chunk("fact", Buffer.from([99, 0, 0, 0, 42])), chunk("data", Buffer.alloc(8, 0xd5))]));
    const doc = parseWav(input, { decodeAudio: false });
    const track = doc.tracks[0]!;
    const output = Buffer.from(serializeWav({ ...doc, tracks: [{ ...track, timescale: 1000,
      samples: empty ? [] : [{ ...track.samples[0]!, duration: 1 }] }] }, { audioCodec: "copy" }));
    assert.equal(output.readUInt32LE(output.indexOf("fact") + 8), empty ? 0 : 8);
    assert.equal(output[output.indexOf("fact") + 12], 42);
    assert.equal(input.readUInt32LE(input.indexOf("fact") + 8), 99);
  });
}
