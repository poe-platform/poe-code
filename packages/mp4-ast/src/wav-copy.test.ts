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
  it(`WAV copy preserves format, extensions, fact and all payload bytes (tag ${tag})`, () => {
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
    const payload = tag === 85 ? Buffer.concat([Buffer.from([0xff, 0xe3, 0x18, 0xc0]), Buffer.alloc(68)]) : Buffer.from(Array.from({ length: tag === 1 ? 12 : tag === 3 || tag === 17 ? 16 : tag === 0xfffe ? 18 : 9 }, (_, i) => i));
    const body = Buffer.concat([Buffer.from("WAVE"), chunk("fmt ", fmt), chunk("fact", fact), chunk("data", payload)]);
    const input = chunk("RIFF", body);
    const output = serializeWav(parseWav(input, { decodeAudio: false }), { audioCodec: "copy" });
    assert.deepEqual(Buffer.from(output), input);
  });
}
