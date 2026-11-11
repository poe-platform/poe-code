import assert from "node:assert/strict";
import { it } from "node:test";
import { rawAudioAsts } from "./containers/raw-audio.js";
import { wavAst } from "./containers/adapters.js";
import { aiffAst } from "./containers/aiff.js";
import { auAst } from "./containers/au.js";

const raw = rawAudioAsts();
// Byte-for-byte outputs from native FFmpeg for the boundary samples below.
const golden = {
  24: {
    s16le: "0080fffefeffffffffffffff00000000000001000100ff00c030ff7f",
    s16be: "8000fefffffeffffffffffff0000000000000001000100ff30c07fff",
    s8: "80feffffffff000000000000307f",
    u8: "007e7f7f7f7f808080808080b0ff"
  },
  32: {
    s16le: "0080feffffffffffffffffff000000000000000000000000e0c0ff7f",
    s16be: "8000fffeffffffffffffffff000000000000000000000000c0e07fff",
    s8: "80ffffffffff000000000000c07f",
    u8: "007f7f7f7f7f80808080808040ff"
  }
};

for (const bits of [24, 32] as const) {
  const values = [-(2 ** (bits - 1)), -65537, -257, -256, -255, -1, 0, 1, 255, 256, 257,
    65535, bits === 24 ? 3195104 : -1059020656, 2 ** (bits - 1) - 1];
  for (const input of [raw.find(plugin => plugin.id === `s${bits}le`)!,
    raw.find(plugin => plugin.id === `s${bits}be`)!, wavAst(), aiffAst(), auAst()]) {
    const endian = input.id === "aiff" || input.id === "au" || input.id.endsWith("be") ? "be" : "le";
    const pcm = raw.find(plugin => plugin.id === `s${bits}${endian}`)!;
    const bytes = Buffer.alloc(values.length * bits / 8);
    values.forEach((value, i) => {
      if (endian === "le") bytes.writeIntLE(value, i * bits / 8, bits / 8);
      else bytes.writeIntBE(value, i * bits / 8, bits / 8);
    });
    const source = pcm.parse(bytes, { sampleRate: 8000 });
    const doc = input === pcm ? source : input.parse(input.serialize(source, { audioCodec: "copy" }));
    for (const [format, hex] of Object.entries(golden[bits])) {
      const outputs = [raw.find(plugin => plugin.id === format)!, wavAst(), aiffAst(), auAst()]
        .filter(plugin => plugin.supportedAudioCodecs.includes(`pcm_${format}`));
      for (const output of outputs) {
        it(`narrows ${bits}-bit ${input.id} to ${format} in ${output.id} like native FFmpeg`, () => {
          const encoded = output.serialize(doc, { audioCodec: `pcm_${format}` });
          const packets = output.parse(encoded).tracks[0]!.samples;
          assert.deepEqual(Buffer.concat(packets.map(packet => packet.data)), Buffer.from(hex, "hex"));
        });
      }
    }
    it(`preserves ${bits}-bit ${input.id} at the same depth and as float64`, () => {
      assert.deepEqual(Buffer.from(pcm.serialize(doc)), bytes);
      const expected = Buffer.alloc(values.length * 8);
      values.forEach((value, i) => expected.writeDoubleLE(value / 2 ** (bits - 1), i * 8));
      assert.deepEqual(Buffer.from(raw.find(plugin => plugin.id === "f64le")!.serialize(doc)), expected);
      if (bits === 32) {
        const narrowed = Buffer.alloc(values.length * 3);
        values.forEach((value, i) => narrowed.writeIntLE(value >> 8, i * 3, 3));
        assert.deepEqual(Buffer.from(raw.find(plugin => plugin.id === "s24le")!.serialize(doc)), narrowed);
      }
    });
  }
}

for (const format of ["f32le", "f64le"]) {
  for (const bits of [16, 32]) {
    it(`matches native integer conversion boundaries for ${format} to PCM${bits}`, () => {
      const values = bits === 16
        ? [65535, 65536, -65536, -65537, 131072, 2 ** 48, -(2 ** 48), 1e30, -1e30]
        : [2 ** 31, 2 ** 32 - 256, 2 ** 32, -(2 ** 32), -(2 ** 32) - 512, 1e30, -1e30];
      const expected = bits === 16
        ? [32767, -32768, -32768, 32767, 0, 0, 0, 0, 0]
        : [2147483647, 2147483647, -2147483648, -2147483648, -2147483648, -2147483648, -2147483648];
      const width = format === "f32le" ? 4 : 8;
      const bytes = Buffer.alloc(values.length * width);
      values.forEach((value, i) => {
        if (width === 4) bytes.writeFloatLE(value, i * width);
        else bytes.writeDoubleLE(value, i * width);
      });
      const doc = raw.find(plugin => plugin.id === format)!.parse(bytes);
      for (const output of [raw.find(plugin => plugin.id === `s${bits}le`)!,
        ...(bits === 16 ? [wavAst(), wavAst("w64")] : [])]) {
        const encoded = output.serialize(doc, { audioCodec: `pcm_s${bits}le` });
        const pcm = Buffer.concat(output.parse(encoded).tracks[0]!.samples.map(packet => packet.data));
        assert.deepEqual(values.map((_, i) => pcm.readIntLE(i * bits / 8, bits / 8)), expected, output.id);
      }
    });
  }
  it(`keeps nearest-even rounding for ${format} sources`, () => {
    const pcm = raw.find(plugin => plugin.id === format)!;
    const width = format === "f32le" ? 4 : 8;
    const bytes = Buffer.alloc(6 * width);
    [-257.5, -1.5, -0.5, 0.5, 1.5, 257.5].forEach((value, i) => {
      if (width === 4) bytes.writeFloatLE(value / 32768, i * width);
      else bytes.writeDoubleLE(value / 32768, i * width);
    });
    const doc = pcm.parse(bytes);
    for (const output of [raw.find(plugin => plugin.id === "s16le")!, wavAst()]) {
      const encoded = output.serialize(doc, { audioCodec: "pcm_s16le" });
      assert.deepEqual(Buffer.concat(output.parse(encoded).tracks[0]!.samples.map(packet => packet.data)),
        Buffer.from("fefefeff0000000002000201", "hex"));
    }
  });
}

for (const bits of [24, 32]) {
  for (const sign of ["s", "u"]) {
    for (const endian of ["le", "be"]) {
      for (const [format, hex] of [["alaw", "55d5d5"], ["mulaw", "7effff"]]) {
        it(`narrows ${sign}${bits}${endian} to PCM16 before ${format} encoding`, () => {
          const bytes = Buffer.alloc(3 * bits / 8);
          [-0.5, 0, 0.5].forEach((value, i) => {
            const sample = value * 2 ** (bits - 16) + (sign === "u" ? 2 ** (bits - 1) : 0);
            if (sign === "u") {
              if (endian === "le") bytes.writeUIntLE(sample, i * bits / 8, bits / 8);
              else bytes.writeUIntBE(sample, i * bits / 8, bits / 8);
            } else if (endian === "le") bytes.writeIntLE(sample, i * bits / 8, bits / 8);
            else bytes.writeIntBE(sample, i * bits / 8, bits / 8);
          });
          const doc = raw.find(plugin => plugin.id === `${sign}${bits}${endian}`)!.parse(bytes);
          const encoded = raw.find(plugin => plugin.id === format)!.serialize(doc);
          assert.deepEqual(Buffer.from(encoded), Buffer.from(hex!, "hex"));
        });
      }
    }
  }
}
